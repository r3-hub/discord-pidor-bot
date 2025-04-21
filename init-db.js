const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('database.db3');
const initSQL = fs.readFileSync('init.sql', 'utf-8');

db.exec(initSQL, (err) => {
  if (err) {
    console.error("❌ Ошибка при создании таблицы:", err.message);
  } else {
    console.log("✅ Таблица успешно создана!");
  }
  db.close();
});