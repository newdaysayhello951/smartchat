// Included after the shared HTTP/database helpers in main.cpp.
#include <openssl/hmac.h>
#include <set>

// Network filenames are UTF-8 metadata, never native filesystem paths.
std::string file_extension(const std::string &name) {
  auto dot=name.find_last_of('.');
  auto slash=name.find_last_of("/\\");
  if(dot==std::string::npos || (slash!=std::string::npos && dot<slash))return "";
  auto extension=name.substr(dot);
  std::transform(extension.begin(),extension.end(),extension.begin(),[](unsigned char c){return c>='A'&&c<='Z'?char(c+('a'-'A')):char(c);});
  return extension;
}

std::string media_type(std::string name) {
  std::transform(name.begin(), name.end(), name.begin(),
                 [](unsigned char c) { return char(std::tolower(c)); });
  if (name.size() >= 11 && name.substr(name.size() - 11) == ".voice.webm")
    return "audio/webm";
  const auto ext = file_extension(name);
  const std::map<std::string, std::string> types = {
      {".png", "image/png"},   {".jpg", "image/jpeg"},
      {".jpeg", "image/jpeg"}, {".gif", "image/gif"},
      {".webp", "image/webp"}, {".mp4", "video/mp4"},
      {".webm", "video/webm"}, {".mov", "video/quicktime"},
      {".mp3", "audio/mpeg"},  {".m4a", "audio/mp4"},
      {".ogg", "audio/ogg"},   {".wav", "audio/wav"}};
  auto found = types.find(ext);
  return found == types.end() ? "application/octet-stream" : found->second;
}
void apply_range(Res &res, const std::string &range) {
  const size_t total = res.body().size();
  auto invalid = [&] {
    res.result(http::status::range_not_satisfiable);
    res.set(http::field::content_range, "bytes */" + std::to_string(total));
    res.body().clear();
  };
  try {
    if (range.rfind("bytes=", 0) != 0 || range.find(',') != std::string::npos ||
        total == 0) {
      invalid();
      return;
    }
    auto value = range.substr(6);
    auto dash = value.find('-');
    if (dash == value.npos) {
      invalid();
      return;
    }
    auto left = value.substr(0, dash), right = value.substr(dash + 1);
    size_t first = 0, last = total - 1;
    if (left.empty()) {
      auto suffix = static_cast<size_t>(number(right));
      if (!suffix) {
        invalid();
        return;
      }
      first = suffix >= total ? 0 : total - suffix;
    } else {
      first = static_cast<size_t>(number(left));
      if (!right.empty())
        last = std::min(total - 1, static_cast<size_t>(number(right)));
    }
    if (first >= total || last < first) {
      invalid();
      return;
    }
    res.result(http::status::partial_content);
    res.set(http::field::content_range, "bytes " + std::to_string(first) + "-" +
                                            std::to_string(last) + "/" +
                                            std::to_string(total));
    res.body() = res.body().substr(first, last - first + 1);
  } catch (...) {
    invalid();
  }
}
#include "product.hpp"
void migrate_features(DB &db) {
  migrate_product(db);
  db.sql("CREATE TABLE IF NOT EXISTS read_cursors(conversation_id BIGINT NOT "
         "NULL,user_id BIGINT NOT NULL,last_seq BIGINT NOT NULL DEFAULT "
         "0,PRIMARY KEY(conversation_id,user_id))");
  db.sql(
      "CREATE TABLE IF NOT EXISTS calls(id CHAR(32) PRIMARY "
      "KEY,conversation_id BIGINT NOT NULL,caller_id BIGINT NOT NULL,callee_id "
      "BIGINT NOT NULL,kind VARCHAR(8) NOT NULL,status VARCHAR(16) NOT "
      "NULL,offer MEDIUMTEXT NOT NULL,answer MEDIUMTEXT,created_at TIMESTAMP "
      "NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,KEY "
      "caller_status(caller_id,status),KEY callee_status(callee_id,status))");
  if(db.sql("SHOW COLUMNS FROM calls LIKE 'caller_seen'").empty()){
    db.sql("ALTER TABLE calls ADD caller_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD callee_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  }
  db.sql("CREATE TABLE IF NOT EXISTS call_events(id BIGINT PRIMARY KEY "
         "AUTO_INCREMENT,user_id BIGINT NOT NULL,call_id CHAR(32) NOT "
         "NULL,event VARCHAR(16) NOT NULL,payload TEXT NOT NULL,created_at "
         "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,KEY "
         "recipient(user_id,id),KEY call_lookup(call_id))");
}
void emit_call(DB &db, const std::string &call, const std::string &user,
               const std::string &type, J payload) {
  db.sql("INSERT INTO call_events(user_id,call_id,event,payload) VALUES(" +
         user + "," + db.q(call) + "," + db.q(type) + "," +
         db.q(payload.dump()) + ")");
}
void expire_calls(DB &db) {
  db.sql("UPDATE calls SET status='missed' WHERE status IN "
         "('ringing','active') AND expires_at<UTC_TIMESTAMP()");
}
std::optional<Res> feature_route(DB &db, long long uid, const URL &url,
                                 const Req &r, const J &b) {
  auto path = url.path;
  auto method = r.method();
  auto us = std::to_string(uid);
  if(auto product=product_route(db,uid,url,r,b))return product;
  auto arg = [&](std::string k, std::string d = "") {
    auto it = url.args.find(k);
    return it == url.args.end() ? d : it->second;
  };
  if (path == "/api/rtc-config" && method == http::verb::get) {
    J ice = J::array();
    auto stun = env("RTC_STUN_URL", "stun:stun.l.google.com:19302");
    if (!stun.empty())
      ice.push_back({{"urls", stun}});
    auto turn = env("TURN_URL"), secret = env("TURN_SECRET");
    auto turn_user=env("TURN_USERNAME"),turn_password=env("TURN_PASSWORD");
    if (!turn.empty() && !secret.empty()) {
      auto expiry = std::chrono::system_clock::to_time_t(
                        std::chrono::system_clock::now()) +
                    3600;
      auto name = std::to_string(expiry) + ":" + us;
      unsigned char hash[EVP_MAX_MD_SIZE];
      unsigned length = 0;
      HMAC(EVP_sha1(), secret.data(), int(secret.size()),
           reinterpret_cast<const unsigned char *>(name.data()), name.size(),
           hash, &length);
      std::string credential(4 * ((length + 2) / 3) + 1, '\0');
      EVP_EncodeBlock(reinterpret_cast<unsigned char *>(credential.data()),
                      hash, length);
      credential.resize(4 * ((length + 2) / 3));
      ice.push_back(
          {{"urls", turn}, {"username", name}, {"credential", credential}});
    } else if(!turn.empty()&&!turn_user.empty()&&!turn_password.empty()) {
      ice.push_back({{"urls",turn},{"username",turn_user},{"credential",turn_password}});
    }
    return result(200, {{"iceServers", ice},
                        {"relayConfigured", !turn.empty() && (!secret.empty()||(!turn_user.empty()&&!turn_password.empty()))}});
  }
  if (path == "/api/read" && method == http::verb::post) {
    auto cid = number(b.at("conversation_id").get<std::string>());
    member(db, uid, cid);
    auto seq = number(b.at("seq").get<std::string>());
    auto c = db.sql("SELECT sequence FROM conversations WHERE id=" +
                    std::to_string(cid));
    seq = std::min(seq, number(c[0]["sequence"]));
    db.sql("INSERT INTO read_cursors VALUES(" + std::to_string(cid) + "," + us +
           "," + std::to_string(seq) +
           ") ON DUPLICATE KEY UPDATE "
           "last_seq=GREATEST(last_seq,VALUES(last_seq))");
    return result(200, {{"ok", true}});
  }
  if (path == "/api/search" && method == http::verb::get) {
    auto cid = number(arg("conversation_id"));
    member(db, uid, cid);
    auto query = arg("q");
    if (query.empty() || query.size() > 200)
      throw Error(400, "搜索词须为 1–200 字节");
    return result(200,
                  db.sql("SELECT m.*,u.username FROM messages m JOIN users u "
                         "ON u.id=m.sender_id WHERE conversation_id=" +
                         std::to_string(cid) + " AND LOCATE(" + db.q(query) +
                         ",m.content)>0 ORDER BY seq DESC LIMIT 100"));
  }
  if (path == "/api/attachments" && method == http::verb::get) {
    auto cid = number(arg("conversation_id"));
    member(db, uid, cid);
    return result(200, db.sql("SELECT f.* FROM files f WHERE conversation_id=" +
                              std::to_string(cid) +
                              " ORDER BY created_at DESC LIMIT 200"));
  }
  if (path == "/api/events" && method == http::verb::get) {
    expire_calls(db);
    auto after = number(arg("after", "0"));
    return result(
        200,
        db.sql(
            "SELECT id,call_id,event,payload FROM call_events WHERE user_id=" +
            us + " AND id>" + std::to_string(after) +
            " ORDER BY id LIMIT 100"));
  }
  if (path == "/api/calls" && method == http::verb::get) {
    expire_calls(db);
    auto id = arg("id");
    if (!id.empty()) {
      auto rows = db.sql(
          "SELECT c.*,u.username AS caller_name,v.username AS callee_name FROM "
          "calls c JOIN users u ON u.id=c.caller_id JOIN users v ON "
          "v.id=c.callee_id WHERE c.id=" +
          db.q(id) + " AND (c.caller_id=" + us + " OR c.callee_id=" + us + ")");
      if (rows.empty())
        throw Error(404, "通话不存在");
      member(db, uid, number(rows[0]["conversation_id"]));
      return result(200, rows[0]);
    }
    auto events = db.sql("SELECT COALESCE(MAX(id),0) AS event_cursor FROM "
                         "call_events WHERE user_id=" +
                         us);
    auto active =
        db.sql("SELECT c.*,u.username AS caller_name,v.username AS callee_name "
               "FROM calls c JOIN users u ON u.id=c.caller_id JOIN users v ON "
               "v.id=c.callee_id WHERE (c.caller_id=" +
               us + " OR c.callee_id=" + us +
               ") AND c.status IN ('ringing','active') ORDER BY c.created_at "
               "DESC LIMIT 1");
    return result(200, {{"cursor", events[0]["event_cursor"]},
                        {"active", active.empty() ? J(nullptr) : active[0]}});
  }
  if (path == "/api/calls" && method == http::verb::post) {
    auto action = b.value("action", "invite");
    expire_calls(db);
    if (action == "invite") {
      auto cid = number(b.at("conversation_id").get<std::string>());
      member(db, uid, cid);
      auto kind = b.value("kind", "audio");
      if(db.sql("SELECT kind FROM conversations WHERE id="+std::to_string(cid))[0]["kind"]=="group")throw Error(400,"群聊暂不支持音视频会议");
      if (kind != "audio" && kind != "video")
        throw Error(400, "无效通话类型");
      auto offer = b.at("offer");
      if (offer.value("type", "") != "offer" ||
          offer.value("sdp", "").size() > 64000)
        throw Error(400, "无效 SDP");
      auto peers = db.sql("SELECT user_id FROM members WHERE conversation_id=" +
                          std::to_string(cid) + " AND user_id<>" + us);
      if (peers.size() != 1)
        throw Error(400, "只支持一对一通话");
      std::string peer = peers[0]["user_id"];
      db.sql("START TRANSACTION");
      db.sql("SELECT id FROM users WHERE id IN (" + us + "," + peer +
             ") ORDER BY id FOR UPDATE");
      auto busy = db.sql("SELECT id FROM calls WHERE status IN "
                         "('ringing','active') AND (caller_id IN (" +
                         us + "," + peer + ") OR callee_id IN (" + us + "," +
                         peer + ")) LIMIT 1");
      if (!busy.empty())
        throw Error(409, "你或对方正在通话中");
      auto recent =
          db.sql("SELECT COUNT(*) n FROM calls WHERE caller_id=" + us +
                 " AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)");
      if (number(recent[0]["n"]) >= 6)
        throw Error(429, "呼叫过于频繁，请稍后重试");
      auto id = random_id();
      db.sql("INSERT INTO "
             "calls(id,conversation_id,caller_id,callee_id,kind,status,offer,"
             "expires_at) VALUES(" +
             db.q(id) + "," + std::to_string(cid) + "," + us + "," + peer +
             "," + db.q(kind) + ",'ringing'," + db.q(offer.dump()) +
             ",DATE_ADD(UTC_TIMESTAMP(),INTERVAL 45 SECOND))");
      emit_call(db, id, peer, "invite", J::object());
      db.sql("COMMIT");
      return result(201, db.sql("SELECT * FROM calls WHERE id=" + db.q(id))[0]);
    }
    auto id = b.at("call_id").get<std::string>();
    db.sql("START TRANSACTION");
    auto rows = db.sql("SELECT * FROM calls WHERE id=" + db.q(id) +
                       " AND (caller_id=" + us + " OR callee_id=" + us +
                       ") FOR UPDATE");
    if (rows.empty())
      throw Error(404, "通话不存在");
    auto c = rows[0];
    member(db, uid, number(c["conversation_id"]));
    std::string status = c["status"], caller = c["caller_id"],
                callee = c["callee_id"];
    auto peer = caller == us ? callee : caller;
    if (action == "heartbeat") {
      if (status == "active") {
        db.sql("UPDATE calls SET "+std::string(caller==us?"caller_seen":"callee_seen")+"=UTC_TIMESTAMP() WHERE id="+db.q(id));
        db.sql("UPDATE calls SET expires_at=DATE_ADD(LEAST(caller_seen,callee_seen),INTERVAL 45 SECOND) WHERE id="+db.q(id));
      }
      db.sql("COMMIT");
      return result(200, {{"status", status}});
    }
    if (status != "ringing" && status != "active") {
      db.sql("COMMIT");
      return result(200, {{"status", status}});
    }
    if (action == "candidate") {
      auto candidate = b.at("candidate");
      if (!candidate.is_object() || candidate.dump().size() > 4096)
        throw Error(400, "无效 ICE candidate");
      auto count = db.sql("SELECT COUNT(*) n FROM call_events WHERE call_id=" +
                          db.q(id) + " AND event='candidate'");
      if (number(count[0]["n"]) >= 300)
        throw Error(429, "ICE 候选超过限制");
      emit_call(db, id, peer, "candidate", candidate);
    } else if (action == "accept") {
      if (us != callee || status != "ringing")
        throw Error(409, "当前不能接听");
      auto answer = b.at("answer");
      if (answer.value("type", "") != "answer" ||
          answer.value("sdp", "").size() > 64000)
        throw Error(400, "无效 SDP");
      db.sql(
          "UPDATE calls SET status='active',answer=" + db.q(answer.dump()) +
          ",caller_seen=UTC_TIMESTAMP(),callee_seen=UTC_TIMESTAMP(),expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 45 SECOND) WHERE id=" +
          db.q(id));
      emit_call(db, id, peer, "accept", J::object());
    } else if (action == "hangup" || action == "reject") {
      if (action == "reject" && (us != callee || status != "ringing"))
        throw Error(409, "当前不能拒绝");
      auto next = action == "reject" ? "rejected" : "ended";
      db.sql("UPDATE calls SET status=" + db.q(next) + " WHERE id=" + db.q(id));
      emit_call(db, id, peer, "end", {{"reason", next}});
      std::string cid = c["conversation_id"];
      db.sql("SELECT id FROM conversations WHERE id=" + cid + " FOR UPDATE");
      db.sql("UPDATE conversations SET sequence=sequence+1 WHERE id=" + cid);
      std::string text =
          (std::string(c["kind"]) == "video" ? "[视频通话] " : "[语音通话] ") +
          std::string(action == "reject"    ? "对方已拒绝"
                      : status == "ringing" ? "已取消"
                                            : "通话结束");
      db.sql("INSERT INTO "
             "messages(conversation_id,sender_id,client_message_id,seq,content)"
             " SELECT id," +
             us + "," + db.q("call:" + id) + ",sequence," + db.q(text) +
             " FROM conversations WHERE id=" + cid);
    } else
      throw Error(400, "无效通话操作");
    db.sql("COMMIT");
    return result(200, {{"ok", true}});
  }
  return std::nullopt;
}
