const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'tmp_seed_full.sql');
const agents = ['alpha','beta','gamma','delta','epsilon'];
const statuses = ['completed','running','pending','failed'];

let tasks = [];
let events = [];
for (let i = 1; i <= 156; i++) {
  const agent = agents[Math.floor(Math.random()*agents.length)];
  const status = statuses[Math.floor(Math.random()*statuses.length)];
  const duration = Math.floor(Math.random()*5000)+500;
  const tid = 'task-' + String(i).padStart(3,'0');
  const input = JSON.stringify({ prompt: `Analyze Q${i%4+1} financials for ${agent}` }).replace(/'/g, "''");
  const output = status === 'completed' ? JSON.stringify({ result: `Processed in ${duration}ms` }).replace(/'/g, "''") : null;
  const completedAt = status === 'completed' ? new Date(Date.now()-duration).toISOString() : null;
  tasks.push(`('${tid}','${agent}','${status}','${input}',${output?`'${output}'`:'NULL'},${status==='completed'?duration:'NULL'},${completedAt?`'${completedAt}'`:'NULL'})`);
  events.push(`('${tid}','${agent}','init','{}',NULL,NULL)`);
  events.push(`('${tid}','${agent}','assign','{}',NULL,NULL)`);
  events.push(`('${tid}','${agent}','complete',${output?`'${output}'`:'NULL'},'${status}',${status==='completed'?duration:'NULL'})`);
}

const sql = [];
sql.push('BEGIN;');
sql.push('INSERT INTO agent_tasks (task_id, agent_name, status, input, output, duration, completed_at) VALUES');
sql.push(tasks.join(',\n') + ';');
sql.push('INSERT INTO agent_events (task_id, agent_name, type, payload, status, duration) VALUES');
sql.push(events.join(',\n') + ';');
sql.push('COMMIT;');

fs.writeFileSync(out, sql.join('\n'));
console.log('Wrote', out);
