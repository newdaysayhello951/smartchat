#include <algorithm>
#include <atomic>
#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/beast/websocket.hpp>
#include <cctype>
#include <csignal>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mysql.h>
#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <optional>
#include <sstream>
#include <thread>
namespace net = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
namespace ws = beast::websocket;
using tcp = net::ip::tcp;
using J = nlohmann::json;
using Req = http::request<http::string_body>;
using Res = http::response<http::string_body>;
std::string env(const char *k, std::string d = "") {
  auto v = getenv(k);
  return v ? v : d;
}
std::string hex(const unsigned char *p, size_t n) {
  const char *h = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < n; i++) {
    s += h[p[i] >> 4];
    s += h[p[i] & 15];
  }
  return s;
}
std::string random_id(size_t n = 16) {
  std::vector<unsigned char> b(n);
  if (RAND_bytes(b.data(), int(n)) != 1)
    throw std::runtime_error("random failed");
  return hex(b.data(), n);
}
std::string digest(std::string s) {
  unsigned char b[32];
  SHA256((const unsigned char *)s.data(), s.size(), b);
  return hex(b, 32);
}
std::string password(std::string p, std::string salt) {
  unsigned char b[32];
  if (PKCS5_PBKDF2_HMAC(p.data(), int(p.size()),
                        (const unsigned char *)salt.data(), int(salt.size()),
                        210000, EVP_sha256(), 32, b) != 1)
    throw std::runtime_error("hash failed");
  return hex(b, 32);
}
struct Error : std::runtime_error {
  int status;
  Error(int s, std::string m) : runtime_error(m), status(s) {}
};
struct DB {
  MYSQL *c;
  DB() {
    c = mysql_init(nullptr);
    unsigned t = 5;
    mysql_options(c, MYSQL_OPT_CONNECT_TIMEOUT, &t);
    mysql_options(c, MYSQL_OPT_READ_TIMEOUT, &t);
    mysql_options(c, MYSQL_OPT_WRITE_TIMEOUT, &t);
    if (!mysql_real_connect(
            c, env("DB_HOST", "127.0.0.1").c_str(),
            env("DB_USER", "im").c_str(), env("DB_PASSWORD").c_str(),
            env("DB_NAME", "im").c_str(),
            static_cast<unsigned>(std::stoi(env("DB_PORT", "3306"))), nullptr,
            0)) {
      mysql_close(c);
      throw std::runtime_error("database unavailable");
    }
    mysql_set_character_set(c, "utf8mb4");
    sql("SET time_zone='+00:00'");
  }
  ~DB() { mysql_close(c); }
  std::string q(std::string s) {
    std::string o(s.size() * 2 + 1, '\0');
    auto n = mysql_real_escape_string(c, o.data(), s.data(), static_cast<unsigned long>(s.size()));
    o.resize(n);
    return "'" + o + "'";
  }
  J sql(std::string s) {
    if (mysql_query(c, s.c_str()))
      throw std::runtime_error("database query failed");
    MYSQL_RES *r = mysql_store_result(c);
    J a = J::array();
    if (!r)
      return a;
    auto f = mysql_fetch_fields(r);
    auto n = mysql_num_fields(r);
    while (auto row = mysql_fetch_row(r)) {
      J o;
      auto len = mysql_fetch_lengths(r);
      for (unsigned i = 0; i < n; i++)
        o[f[i].name] = row[i] ? J(std::string(row[i], len[i])) : J(nullptr);
      a.push_back(o);
    }
    mysql_free_result(r);
    return a;
  }
  long long last() { return mysql_insert_id(c); }
};
long long number(const std::string &s) {
  try {
    size_t n;
    auto x = std::stoll(s, &n);
    if (n != s.size() || x < 0)
      throw Error(400, "invalid number");
    return x;
  } catch (...) {
    throw Error(400, "invalid number");
  }
}
std::string decode(std::string s) {
  std::string o;
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == '%') {
      auto hex_digit = [](unsigned char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
               (c >= 'A' && c <= 'F');
      };
      if (i + 2 >= s.size() || !hex_digit(s[i + 1]) ||
          !hex_digit(s[i + 2]))
        throw Error(400, "invalid encoding");
      auto h = s.substr(i + 1, 2);
      char *end = nullptr;
      long v = strtol(h.c_str(), &end, 16);
      if (*end)
        throw Error(400, "invalid encoding");
      o += char(v);
      i += 2;
    } else
      o += s[i] == '+' ? ' ' : s[i];
  }
  return o;
}
struct URL {
  std::string path;
  std::map<std::string, std::string> args;
  URL(std::string s) {
    auto p = s.find('?');
    path = s.substr(0, p);
    if (p == s.npos)
      return;
    std::istringstream in(s.substr(p + 1));
    std::string kv;
    while (std::getline(in, kv, '&')) {
      auto e = kv.find('=');
      args[decode(kv.substr(0, e))] =
          e == kv.npos ? "" : decode(kv.substr(e + 1));
    }
  }
};
long long auth(DB &db, std::string token) {
  auto a = db.sql("SELECT user_id FROM sessions WHERE token_hash=" +
                  db.q(digest(token)) + " AND expires_at>UTC_TIMESTAMP()");
  if (a.empty())
    throw Error(401, "请重新登录");
  return number(a[0]["user_id"]);
}
void member(DB &db, long long uid, long long cid) {
  if (db.sql(
            "SELECT user_id FROM members WHERE user_id=" + std::to_string(uid) +
            " AND conversation_id=" + std::to_string(cid))
          .empty())
    throw Error(403, "无权访问该会话");
}
J ai_call(std::string path, J body) {
  net::io_context io;
  tcp::resolver resolver(io);
  beast::tcp_stream stream(io);
  net::steady_timer deadline(io);
  beast::error_code failure;
  bool finished = false;
  http::request<http::string_body> r{http::verb::post, path, 11};
  r.set(http::field::host, "ai");
  r.set(http::field::content_type, "application/json");
  r.set("X-Internal-Secret", env("INTERNAL_SECRET"));
  r.body() = body.dump();
  r.prepare_payload();
  beast::flat_buffer buffer;
  http::response_parser<http::string_body> parser;
  parser.body_limit(2 * 1024 * 1024);
  auto finish = [&](beast::error_code ec) {
    if (finished)
      return;
    finished = true;
    failure = ec;
    deadline.cancel();
  };
  deadline.expires_after(std::chrono::seconds(10));
  deadline.async_wait([&](beast::error_code ec) {
    if (ec)
      return;
    resolver.cancel();
    beast::error_code ignored;
    stream.socket().close(ignored);
    finish(net::error::timed_out);
  });
  resolver.async_resolve(
      env("AI_HOST", "ai"), env("AI_PORT", "8000"),
      [&](beast::error_code ec, tcp::resolver::results_type endpoints) {
        if (finished)
          return;
        if (ec) {
          finish(ec);
          return;
        }
        stream.async_connect(endpoints, [&](beast::error_code ec,
                                            const tcp::endpoint &) {
          if (finished)
            return;
          if (ec) {
            finish(ec);
            return;
          }
          http::async_write(stream, r, [&](beast::error_code ec, size_t) {
            if (finished)
              return;
            if (ec) {
              finish(ec);
              return;
            }
            http::async_read(stream, buffer, parser,
                             [&](beast::error_code ec, size_t) { finish(ec); });
          });
        });
      });
  io.run();
  if (failure)
    throw Error(502, "AI 服务连接失败或超时");
  auto res = parser.release();
  if (res.result_int() >= 400)
    throw Error(502, "AI 服务暂不可用");
  return J::parse(res.body());
}
J messages(DB &db, long long cid, long long after, int limit = 100) {
  return db.sql("SELECT m.*,u.username FROM messages m JOIN users u ON "
                "u.id=m.sender_id WHERE conversation_id=" +
                std::to_string(cid) + " AND seq>" + std::to_string(after) +
                " ORDER BY seq LIMIT " + std::to_string(limit));
}
Res result(int code, J j) {
  Res r{static_cast<http::status>(code), 11};
  r.set(http::field::content_type, "application/json; charset=utf-8");
  r.set(http::field::cache_control, "no-store");
  r.body() = j.dump();
  r.keep_alive(false);
  r.prepare_payload();
  return r;
}
#include "features.hpp"
Res route(const Req &r) {
  try {
    URL url(std::string(r.target()));
    auto path = url.path;
    auto method = r.method();
    if (path == "/api/health")
      return result(200, {{"status", "ok"}});
    DB db;
    J b = J::object();
    if (r[http::field::content_type].find("application/json") !=
            beast::string_view::npos &&
        !r.body().empty())
      b = J::parse(r.body());
    if (path == "/api/register" || path == "/api/login") {
      if (method != http::verb::post) {
        throw Error(405, "method not allowed");
      }
      auto name = b.value("username", "");
      auto p = b.value("password", "");
      if (name.size() < 2 || name.size() > 64 || p.size() < 8 || p.size() > 128)
        throw Error(400, "用户名需 2–64 字节，密码需 8–128 字节");
      if (path == "/api/register") {
        auto salt = random_id();
        try {
          db.sql("INSERT INTO users(username,password_hash) VALUES(" +
                 db.q(name) + "," + db.q(salt + ":" + password(p, salt)) + ")");
        } catch (...) {
          throw Error(409, "用户名已存在或注册失败");
        }
      }
      auto a = db.sql("SELECT id,password_hash FROM users WHERE username=" +
                      db.q(name));
      if (a.empty())
        throw Error(401, "用户名或密码错误");
      std::string saved = a[0]["password_hash"];
      auto pos = saved.find(':');
      auto calculated = password(p, saved.substr(0, pos));
      auto expected = saved.substr(pos + 1);
      if (calculated.size() != expected.size() ||
          CRYPTO_memcmp(calculated.data(), expected.data(), expected.size()))
        throw Error(401, "用户名或密码错误");
      auto token = random_id(32);
      db.sql("INSERT INTO sessions VALUES(" + db.q(digest(token)) + "," +
             std::string(a[0]["id"]) +
             ",DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))");
      return result(200, {{"token", token},
                          {"user", {{"id", a[0]["id"]}, {"username", name}}}});
    }
    auto authorization = std::string(r[http::field::authorization]);
    auto uid = auth(db, authorization.rfind("Bearer ", 0) == 0
                            ? authorization.substr(7)
                            : "");
    auto us = std::to_string(uid);
    if (auto feature = feature_route(db, uid, url, r, b))
      return std::move(*feature);
    if (path == "/api/logout" && method == http::verb::post) {
      db.sql("DELETE FROM sessions WHERE token_hash=" +
             db.q(digest(authorization.substr(7))));
      return result(200, {{"ok", true}});
    }
    if (path == "/api/users" && method == http::verb::get)
      return result(200, db.sql("SELECT id,username FROM users WHERE id<>" +
                                us + " ORDER BY id LIMIT 200"));
    if (path == "/api/conversations" && method == http::verb::get)
      return result(
          200,
          db.sql("SELECT c.id,c.sequence,u.id AS peer_id,u.username,"
                 "(SELECT content FROM messages WHERE conversation_id=c.id "
                 "ORDER BY seq DESC LIMIT 1) AS last_message,"
                 "(SELECT created_at FROM messages WHERE conversation_id=c.id "
                 "ORDER BY seq DESC LIMIT 1) AS last_time,"
                 "c.sequence-COALESCE((SELECT last_seq FROM read_cursors WHERE "
                 "conversation_id=c.id AND user_id=" +
                 us +
                 "),0) AS unread FROM conversations c JOIN "
                 "members m ON m.conversation_id=c.id AND m.user_id=" +
                 us +
                 " JOIN members other ON other.conversation_id=c.id AND "
                 "other.user_id<>" +
                 us +
                 " JOIN users u ON u.id=other.user_id ORDER BY "
                 "COALESCE(last_time,c.created_at) DESC"));
    if (path == "/api/conversations" && method == http::verb::post) {
      auto peer = number(b.at("user_id").get<std::string>());
      if (peer == uid ||
          db.sql("SELECT id FROM users WHERE id=" + std::to_string(peer))
              .empty())
        throw Error(400, "用户不存在");
      auto key = std::to_string(std::min(uid, peer)) + ":" +
                 std::to_string(std::max(uid, peer));
      db.sql("START TRANSACTION");
      db.sql("INSERT INTO conversations(pair_key) VALUES(" + db.q(key) +
             ") ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");
      auto cid = db.last();
      db.sql("INSERT IGNORE INTO members VALUES(" + std::to_string(cid) + "," +
             us + "),(" + std::to_string(cid) + "," + std::to_string(peer) +
             ")");
      db.sql("COMMIT");
      return result(200, {{"id", std::to_string(cid)}});
    }
    if (path == "/api/messages" && method == http::verb::get) {
      auto cid = number(url.args["conversation_id"]);
      member(db, uid, cid);
      if (url.args.count("before"))
        return result(200,
                      db.sql("SELECT m.*,u.username FROM messages m JOIN users "
                             "u ON u.id=m.sender_id WHERE conversation_id=" +
                             std::to_string(cid) + " AND seq<" +
                             std::to_string(number(url.args["before"])) +
                             " ORDER BY seq DESC LIMIT 100"));
      return result(
          200,
          messages(db, cid,
                   number(url.args.count("after") ? url.args["after"] : "0")));
    }
    if (path == "/api/messages" && method == http::verb::post) {
      auto cid = number(b.at("conversation_id").get<std::string>());
      member(db, uid, cid);
      auto client = b.value("client_message_id", "");
      auto content = b.value("content", "");
      auto file = b.value("file_id", "");
      if (client.empty() || client.size() > 80 || content.size() > 16000 ||
          (content.empty() && file.empty()))
        throw Error(400, "消息为空或超过限制");
      db.sql("START TRANSACTION");
      db.sql("SELECT id FROM conversations WHERE id=" + std::to_string(cid) +
             " FOR UPDATE");
      auto old = db.sql("SELECT * FROM messages WHERE sender_id=" + us +
                        " AND client_message_id=" + db.q(client));
      if (!old.empty()) {
        if (std::string(old[0]["conversation_id"]) != std::to_string(cid) ||
            std::string(old[0]["content"]) != content ||
            (old[0]["file_id"].is_null()
                 ? ""
                 : std::string(old[0]["file_id"])) != file)
          throw Error(409, "消息标识已用于不同内容");
        db.sql("COMMIT");
        return result(200, old[0]);
      }
      if (!file.empty() &&
          db.sql("SELECT id FROM files WHERE id=" + db.q(file) +
                 " AND conversation_id=" + std::to_string(cid))
              .empty())
        throw Error(400, "文件不属于该会话");
      db.sql("UPDATE conversations SET sequence=sequence+1 WHERE id=" +
             std::to_string(cid));
      db.sql("INSERT INTO "
             "messages(conversation_id,sender_id,client_message_id,seq,content,"
             "file_id) SELECT id," +
             us + "," + db.q(client) + ",sequence," + db.q(content) + "," +
             (file.empty() ? "NULL" : db.q(file)) +
             " FROM conversations WHERE id=" + std::to_string(cid));
      auto id = db.last();
      db.sql("COMMIT");
      return result(200, db.sql("SELECT * FROM messages WHERE id=" +
                                std::to_string(id))[0]);
    }
    if (path == "/api/files" && method == http::verb::post) {
      auto cid = number(url.args["conversation_id"]);
      member(db, uid, cid);
      auto name = url.args["name"];
      auto ext = file_extension(name);
      if (name.empty() || name.size() > 240 || name.find('/') != name.npos ||
          name.find('\\') != name.npos || name.find('\0') != name.npos)
        throw Error(400, "无效文件名");
      if (r.body().empty() || r.body().size() > 50 * 1024 * 1024)
        throw Error(413, "文件须为 1 字节至 50 MB");
      auto id = random_id();
      auto disk =
          (std::filesystem::path(env("FILE_DIR", "/data/files")) / id).string();
      std::ofstream out(disk, std::ios::binary);
      out.write(r.body().data(), r.body().size());
      out.close();
      if (!out) {
        std::filesystem::remove(disk);
        throw Error(500, "文件写入失败");
      }
      try {
        db.sql("INSERT INTO files(id,conversation_id,uploader_id,name,size) "
               "VALUES(" +
               db.q(id) + "," + std::to_string(cid) + "," + us + "," +
               db.q(name) + "," + std::to_string(r.body().size()) + ")");
      } catch (...) {
        std::filesystem::remove(disk);
        throw;
      }
      J index = {{"status", "unavailable"}};
      try {
        if (ext == ".txt" || ext == ".md" || ext == ".pdf" || ext == ".docx" || ext == ".csv" || ext == ".log" || ext==".png" || ext==".jpg" || ext==".jpeg" || ext==".webp" || ext==".gif")
          index = ai_call("/index", {{"file_id", id},
                                     {"conversation_id", std::to_string(cid)},
                                     {"name", name}});
      } catch (...) {
      }
      return result(200, {{"id", id}, {"name", name}, {"index", index}});
    }
    if (path == "/api/files" && method == http::verb::get) {
      auto a = db.sql("SELECT * FROM files WHERE id=" + db.q(url.args["id"]));
      if (a.empty())
        throw Error(404, "文件不存在");
      member(db, uid, number(a[0]["conversation_id"]));
      std::ifstream f(std::filesystem::path(env("FILE_DIR", "/data/files")) /
                          std::string(a[0]["id"]),
                      std::ios::binary);
      if (!f)
        throw Error(404, "文件内容不存在");
      Res res{http::status::ok, 11};
      res.body() = std::string(std::istreambuf_iterator<char>(f), {});
      res.set(http::field::content_type, "application/octet-stream");
      res.set(http::field::content_disposition, "attachment");
      res.set(http::field::content_type, media_type(std::string(a[0]["name"])));
      res.set(http::field::accept_ranges, "bytes");
      if (url.args["inline"] == "1" &&
          media_type(std::string(a[0]["name"])) != "application/octet-stream")
        res.set(http::field::content_disposition, "inline");
      auto range = std::string(r[http::field::range]);
      if (!range.empty())
        apply_range(res, range);
      res.set("X-Content-Type-Options", "nosniff");
      res.keep_alive(false);
      res.prepare_payload();
      return res;
    }
    if (path == "/api/ai" && method == http::verb::post) {
      auto cid = number(b.at("conversation_id").get<std::string>());
      member(db, uid, cid);
      auto mode = b.value("mode", "ask");
      if (mode != "ask" && mode != "summary" && mode != "index" &&
          mode != "agent")
        throw Error(400, "无效任务类型");
      auto count =
          db.sql("SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id=" + us +
                 " AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)");
      if (number(count[0]["n"]) >= 6)
        throw Error(429, "AI 任务过于频繁，请稍后重试");
      J payload = {{"conversation_id", std::to_string(cid)},
                   {"mode", mode},
                   {"question", b.value("question", "")}};
      if (mode == "ask" || mode == "agent")
        payload["messages"] = db.sql(
            "SELECT m.seq,m.content,m.created_at,u.username FROM messages m "
            "JOIN users u ON u.id=m.sender_id WHERE conversation_id=" +
            std::to_string(cid) + " AND m.recalled=0 ORDER BY seq DESC LIMIT 200");
      if (mode == "index" || mode == "agent") {
        auto files = db.sql("SELECT id,name FROM files WHERE conversation_id=" +
                            std::to_string(cid));
        payload["files"] = files;
      }
      if (mode == "summary") {
        auto from = b.value("from", std::string("1970-01-01 00:00:00"));
        auto to = b.value("to", std::string("2099-12-31 23:59:59"));
        auto rows = db.sql(
            "SELECT m.seq,m.content,m.created_at,u.username FROM messages m "
            "JOIN users u ON u.id=m.sender_id WHERE conversation_id=" +
            std::to_string(cid) + " AND m.recalled=0 AND m.created_at>=" + db.q(from) +
            " AND m.created_at<=" + db.q(to) + " ORDER BY seq LIMIT 2001");
        if (rows.size() > 2000)
          throw Error(400, "此时间范围超过 2000 条消息，请缩小范围");
        payload["messages"] = rows;
      }
      auto job = ai_call("/jobs", payload);
      auto id = job.at("id").get<std::string>();
      db.sql("INSERT INTO ai_jobs(id,user_id,conversation_id) VALUES(" +
             db.q(id) + "," + us + "," + std::to_string(cid) + ")");
      return result(202, job);
    }
    if (path == "/api/jobs" && method == http::verb::get) {
      auto id = url.args["id"];
      auto a =
          db.sql("SELECT conversation_id FROM ai_jobs WHERE id=" + db.q(id) +
                 " AND user_id=" + us);
      if (a.empty())
        throw Error(404, "任务不存在");
      member(db, uid, number(a[0]["conversation_id"]));
      return result(200, ai_call("/status", {{"id", id}}));
    }
    throw Error(404, "接口不存在");
  } catch (const Error &e) {
    return result(e.status, {{"error", e.what()}});
  } catch (const J::exception &) {
    return result(400, {{"error", "请求字段错误"}});
  } catch (const std::exception &e) {
    std::cerr << "request failed: " << e.what() << std::endl;
    return result(503, {{"error", "服务暂时不可用，请稍后重试"}});
  }
}
net::thread_pool workers(8);
std::atomic<int> pending{0}, connections{0};
template <class F> bool work(F f) {
  if (pending.fetch_add(1) >= 128) {
    --pending;
    return false;
  }
  net::post(workers, [f = std::move(f)]() mutable {
    try {
      f();
    } catch (const std::exception &e) {
      std::cerr << "worker: " << e.what() << std::endl;
    }
    --pending;
  });
  return true;
}
#include "download.hpp"
struct Socket : std::enable_shared_from_this<Socket> {
  ws::stream<beast::tcp_stream> socket;
  beast::flat_buffer buffer;
  net::steady_timer timer;
  std::deque<std::string> queue;
  std::string token, cid;
  long long cursor = 0;
  bool stopped = false, ready = false;
  explicit Socket(beast::tcp_stream s)
      : socket(std::move(s)), timer(socket.get_executor()) {}
  ~Socket() { --connections; }
  void start(Req r) {
    URL u(std::string(r.target()));
    cid = u.args["conversation_id"];
    try {
      if (u.args["events"] != "1")
        number(cid);
      else
        cid = "events";
      cursor = number(u.args.count("after") ? u.args["after"] : "0");
    } catch (...) {
      return;
    }
    beast::get_lowest_layer(socket).expires_never();
    socket.set_option(
        ws::stream_base::timeout::suggested(beast::role_type::server));
    socket.read_message_max(20000);
    socket.async_accept(r, [self = shared_from_this()](beast::error_code ec) {
      if (!ec)
        self->read();
    });
  }
  void stop() {
    if (stopped)
      return;
    stopped = true;
    timer.cancel();
    beast::error_code ec;
    beast::get_lowest_layer(socket).socket().close(ec);
  }
  void read() {
    socket.async_read(
        buffer, [self = shared_from_this()](beast::error_code ec, size_t) {
          if (ec) {
            self->stop();
            return;
          }
          try {
            auto j = J::parse(beast::buffers_to_string(self->buffer.data()));
            self->buffer.consume(self->buffer.size());
            if (!self->ready) {
              if (j.value("type", "") != "auth")
                throw std::runtime_error("auth required");
              self->token = j.at("token").get<std::string>();
              self->ready = true;
              self->poll();
            } else if (j.value("type", "") == "chat") {
              Req r{http::verb::post, "/api/messages", 11};
              r.set(http::field::content_type, "application/json");
              r.set(http::field::authorization, "Bearer " + self->token);
              j["conversation_id"] = self->cid;
              r.body() = j.dump();
              if (!work([self, r = std::move(r)] {
                    auto res = route(r);
                    net::post(self->socket.get_executor(),
                              [self, res = std::move(res)] {
                                self->send(J{{"type", "ack"},
                                             {"status", res.result_int()},
                                             {"data", J::parse(res.body())}}
                                               .dump());
                              });
                  }))
                self->send("{\"type\":\"busy\"}");
            }
            self->read();
          } catch (...) {
            self->stop();
          }
        });
  }
  void send(std::string s) {
    if (stopped)
      return;
    if (queue.size() >= 64) {
      stop();
      return;
    }
    queue.push_back(std::move(s));
    if (queue.size() == 1)
      write();
  }
  void write() {
    socket.async_write(
        net::buffer(queue.front()),
        [self = shared_from_this()](beast::error_code ec, size_t) {
          if (ec) {
            self->stop();
            return;
          }
          self->queue.pop_front();
          if (!self->queue.empty())
            self->write();
        });
  }
  void poll() {
    if (stopped)
      return;
    auto self = shared_from_this();
    if (!work([self] {
          Req r{http::verb::get,
                (self->cid == "events" ? "/api/events?after="
                                       : "/api/messages?conversation_id=" +
                                             self->cid + "&after=") +
                    std::to_string(self->cursor),
                11};
          r.set(http::field::authorization, "Bearer " + self->token);
          auto res = route(r);
          net::post(self->socket.get_executor(), [self, res = std::move(res)] {
            if (self->stopped)
              return;
            if (res.result_int() != 200) {
              self->stop();
              return;
            }
            auto a = J::parse(res.body());
            if (!a.empty()) {
              self->cursor =
                  number(a.back()[self->cid == "events" ? "id" : "seq"]);
              self->send(J{
                  {"type", self->cid == "events" ? "events" : "messages"},
                  {"data",
                   a}}.dump());
            }
            self->later();
          });
        }))
      later();
  }
  void later() {
    timer.expires_after(std::chrono::milliseconds(700));
    timer.async_wait([self = shared_from_this()](beast::error_code ec) {
      if (!ec)
        self->poll();
    });
  }
};
struct HTTP : std::enable_shared_from_this<HTTP> {
  beast::tcp_stream stream;
  beast::flat_buffer buffer;
  http::request_parser<http::string_body> parser;
  bool transferred = false;
  explicit HTTP(tcp::socket s) : stream(std::move(s)) {
    ++connections;
    parser.body_limit(50 * 1024 * 1024);
    parser.header_limit(16384);
  }
  ~HTTP() {
    if (!transferred)
      --connections;
  }
  void start() {
    stream.expires_after(std::chrono::seconds(15));
    http::async_read_header(stream,buffer,parser,[self=shared_from_this()](beast::error_code ec,size_t){
      if(ec){if(ec==http::error::body_limit)self->reply(result(413,{{"error","请求超过 50 MB"}}));return;}
      auto target=std::string(self->parser.get().target());
      bool upload=self->parser.get().method()==http::verb::post && (target.rfind("/api/files?",0)==0||target.rfind("/api/uploads/chunk?",0)==0);
      self->stream.expires_after(std::chrono::seconds(upload?300:30));
      self->read_body();
    });
  }
  void read_body() {
    http::async_read(stream, buffer, parser,
                     [self = shared_from_this()](beast::error_code ec, size_t) {
                       if (ec) {
                         if (ec == http::error::body_limit)
                           self->reply(
                               result(413, {{"error", "请求超过 50 MB"}}));
                         return;
                       }
                       auto r = self->parser.release();
                       auto target=std::string(r.target());
                       if(r.method()==http::verb::get && (target=="/api/files"||target.rfind("/api/files?",0)==0)){
                         if(!work([self,r=std::move(r)]{try{auto info=prepare_download(r);net::post(self->stream.get_executor(),[self,info=std::move(info)]()mutable{self->transferred=true;std::make_shared<DownloadSession>(std::move(self->stream),std::move(info))->start();});}catch(const Error&e){auto res=result(e.status,{{"error",e.what()}});net::post(self->stream.get_executor(),[self,res=std::move(res)]()mutable{self->reply(std::move(res));});}catch(...){net::post(self->stream.get_executor(),[self]{self->reply(result(503,{{"error","文件服务暂不可用"}}));});}}))self->reply(result(503,{{"error","服务器繁忙"}}));return;
                       }
                       if (ws::is_upgrade(r) &&
                           std::string(r.target()).rfind("/ws?", 0) == 0) {
                         self->transferred = true;
                         std::make_shared<Socket>(std::move(self->stream))
                             ->start(std::move(r));
                         return;
                       }
                       if (!work([self, r = std::move(r)] {
                             auto res = route(r);
                             net::post(self->stream.get_executor(),
                                       [self, res = std::move(res)]() mutable {
                                         self->reply(std::move(res));
                                       });
                           }))
                         self->reply(result(503, {{"error", "服务器繁忙"}}));
                     });
  }
  void reply(Res r) {
    auto res = std::make_shared<Res>(std::move(r));
    stream.expires_after(std::chrono::seconds(res->body().size()>1024*1024?300:30));
    http::async_write(
        stream, *res,
        [self = shared_from_this(), res](beast::error_code, size_t) {
          beast::error_code ec;
          self->stream.socket().shutdown(tcp::socket::shutdown_both, ec);
        });
  }
};
int main() {
  try {
    if (env("INTERNAL_SECRET").size() < 16)
      throw std::runtime_error(
          "INTERNAL_SECRET must contain at least 16 characters");
    std::filesystem::create_directories(env("FILE_DIR", "/data/files"));
    {
      DB db;
      migrate_features(db);
    }
    net::io_context io;
    tcp::acceptor acceptor(
        io,
        {net::ip::make_address(env("BIND_HOST", "0.0.0.0")),
         static_cast<unsigned short>(std::stoi(env("SERVER_PORT", "8080")))});
    std::function<void()> accept;
    accept = [&] {
      acceptor.async_accept(
          net::make_strand(io), [&](beast::error_code ec, tcp::socket socket) {
            if (!ec && connections < 512)
              std::make_shared<HTTP>(std::move(socket))->start();
            if (acceptor.is_open())
              accept();
          });
    };
    accept();
    net::steady_timer shutdown(io);
    net::signal_set signals(io, SIGINT, SIGTERM);
    signals.async_wait([&](beast::error_code, int) {
      acceptor.close();
      shutdown.expires_after(std::chrono::seconds(10));
      shutdown.async_wait([&](beast::error_code) { io.stop(); });
    });
    std::cerr << "im server listening on :" << env("SERVER_PORT","8080") << " (8 workers, queue 128, "
                 "connections 512)"
              << std::endl;
    std::vector<std::thread> ts;
    for (int i = 0; i < 2; i++)
      ts.emplace_back([&] { io.run(); });
    io.run();
    for (auto &t : ts)
      t.join();
    workers.join();
  } catch (const std::exception &e) {
    std::cerr << e.what() << std::endl;
    return 1;
  }
}
