// 清空 training_sessions 表（开发环境测试数据）
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: '117.72.30.78',
    port: 3306,
    user: 'mofang',
    password: 'mofang_dev_pwd',
    database: 'mofang_dev',
  });

  console.log('连接成功，查询 training_sessions 总数...');
  const [rows] = await conn.execute('SELECT COUNT(*) as total FROM training_sessions');
  console.log(`当前共 ${rows[0].total} 条会话`);

  console.log('清空 training_sessions 表...');
  await conn.execute('DELETE FROM training_sessions');
  console.log('清空完成');

  await conn.end();
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
