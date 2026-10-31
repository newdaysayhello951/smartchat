"""Process wrapper: writes its own PID for safe project-specific shutdown."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
name=sys.argv[1]
(root/"data"/f"{name if name!='mysql' else 'mysql-wrapper'}.pid").write_text(str(os.getpid()),encoding="ascii")
if name=="ai":
    os.environ["PROJECT_ENV_FILE"] = str(root / ".env")
    import uvicorn
    sys.path.insert(0,str(root/"ai"))
    uvicorn.run("app:app",host="127.0.0.1",port=8000,limit_concurrency=64)
elif name=="web":
    # Vite is retained as the native reverse proxy; production assets built separately.
    os.chdir(root/"web")
    process=subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "8080", "--strictPort"])
    (root/"data"/"vite.pid").write_text(str(process.pid),encoding="ascii")
    sys.exit(process.wait())
elif name=="mysql":
    mysql_root=Path(os.environ["SMART_IM_MYSQL_ROOT"])
    process=subprocess.Popen([str(mysql_root/"bin/mysqld.exe"),"--no-defaults","--basedir="+str(mysql_root),"--datadir="+os.environ["SMART_IM_DB_DIR"],"--port=3307","--bind-address=127.0.0.1","--mysqlx=0","--skip-log-bin","--innodb-buffer-pool-size=64M","--max-connections=48","--console"],cwd=root)
    (root/"data/mysql.pid").write_text(str(process.pid),encoding="ascii")
    sys.exit(process.wait())
else:
    raise SystemExit("unknown service")
