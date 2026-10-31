"""Initialize only the app-owned MySQL instance, never the system service."""
import os
from pathlib import Path
import secrets
import time
import pymysql

root=Path(__file__).resolve().parents[1]
password=os.environ["MYSQL_PASSWORD"]
connection=None
for attempt in range(60):
    try:
        connection=pymysql.connect(host="127.0.0.1",port=3307,user="root",password=os.environ.get("MYSQL_ROOT_PASSWORD", ""),charset="utf8mb4")
        break
    except pymysql.err.OperationalError as error:
        if error.args[0]==1045:
            connection=pymysql.connect(host="127.0.0.1",port=3307,user="root",password="",charset="utf8mb4")
            break
        time.sleep(.5)
if connection is None:
    raise RuntimeError("Project MySQL on 3307 did not start. Check data/logs/mysql-error.log")
with connection:
    with connection.cursor() as cursor:
        cursor.execute("CREATE DATABASE IF NOT EXISTS smart_im CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cursor.execute("CREATE USER IF NOT EXISTS 'im'@'127.0.0.1' IDENTIFIED BY %s",(password,))
        cursor.execute("ALTER USER 'im'@'127.0.0.1' IDENTIFIED BY %s",(password,))
        cursor.execute("GRANT ALL PRIVILEGES ON smart_im.* TO 'im'@'127.0.0.1'")
        cursor.execute("USE smart_im")
        source=(root/"db/init.sql").read_text(encoding="utf-8")
        for statement in source.split(';'):
            if statement.strip():
                # Initial schema is idempotent. Never drops existing data.
                cursor.execute(statement.replace("CREATE TABLE ","CREATE TABLE IF NOT EXISTS "))
        if os.environ.get("MYSQL_ROOT_PASSWORD"):
            cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s",(os.environ["MYSQL_ROOT_PASSWORD"],))
    connection.commit()
print("Project database ready on 127.0.0.1:3307; existing MySQL service untouched.")
