"""Remove only accounts matching the exact generated test-name formats.
Dry run by default. Run with --apply after local acceptance tests.
"""
import argparse
import os
from pathlib import Path
import re
import sqlite3
import pymysql

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
settings={}
for line in (root/'.env').read_text(encoding='utf-8-sig').splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1);settings[key]=value
pattern=re.compile(r'^(?:test_[a-f0-9]{8}_[0-9]|ws_[ab]_[a-f0-9]{8}|feature_[abc][a-f0-9]{8}|e2e_[ABC]_[a-f0-9]{8}|ai_[abc][a-f0-9]{8})$')
db=pymysql.connect(host='127.0.0.1',port=3307,user='im',password=settings['MYSQL_PASSWORD'],database='smart_im',charset='utf8mb4',cursorclass=pymysql.cursors.DictCursor)
with db:
    with db.cursor() as cursor:
        cursor.execute('SELECT id,username FROM users');users=[r['id'] for r in cursor.fetchall() if pattern.fullmatch(r['username'])]
        if not users:print('No generated test accounts.');raise SystemExit(0)
        cursor.execute('SELECT conversation_id,user_id FROM members');members={}
        for row in cursor.fetchall():members.setdefault(row['conversation_id'],set()).add(row['user_id'])
        conversations=[cid for cid,ids in members.items() if ids.issubset(set(users))]
        print(f'Generated test accounts: {len(users)}; exclusively test conversations: {len(conversations)}; apply={args.apply}')
        if not args.apply:raise SystemExit(0)
        def markers(values):return ','.join(['%s']*len(values))
        files=[]
        if conversations:
            placeholders=markers(conversations)
            cursor.execute('SELECT id FROM files WHERE conversation_id IN ('+placeholders+')',conversations);files=[r['id'] for r in cursor.fetchall()]
            cursor.execute('DELETE e FROM call_events e JOIN calls c ON c.id=e.call_id WHERE c.conversation_id IN ('+placeholders+')',conversations)
            cursor.execute('DELETE p FROM upload_parts p JOIN uploads u ON u.id=p.upload_id WHERE u.conversation_id IN ('+placeholders+')',conversations)
            for table in ('calls','ai_jobs','read_cursors','message_events','uploads','messages','files','members'):
                cursor.execute('DELETE FROM '+table+' WHERE conversation_id IN ('+placeholders+')',conversations)
            cursor.execute('DELETE FROM conversations WHERE id IN ('+placeholders+')',conversations)
        cursor.execute('DELETE FROM friends WHERE low_id IN ('+markers(users)+') OR high_id IN ('+markers(users)+')',users+users)
        cursor.execute('DELETE FROM friend_requests WHERE sender_id IN ('+markers(users)+') OR target_id IN ('+markers(users)+')',users+users)
        cursor.execute('DELETE FROM sessions WHERE user_id IN ('+markers(users)+')',users)
        # Keep a test-named user if they have entered a non-test conversation.
        cursor.execute('DELETE FROM users WHERE id IN ('+markers(users)+') AND id NOT IN (SELECT user_id FROM members)',users)
    db.commit()
for fid in files:
    if re.fullmatch('[a-f0-9]{32}',fid):
        path=(root/'data/files'/fid).resolve()
        if path.parent==(root/'data/files').resolve():path.unlink(missing_ok=True)
index=root/'data/index/index.db'
if index.exists() and conversations:
    with sqlite3.connect(index) as connection:
        connection.execute('DELETE FROM chunks WHERE conversation_id IN ('+','.join('?'*len(conversations))+')',list(map(str,conversations)))
print('Generated test data cleaned; ordinary user accounts left intact.')
