require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");
const locales = require("./locales");
const schedules = require("./schedules");

if (!process.env.BOT_TOKEN) { console.error("❌ BOT_TOKEN missing"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("❌ DATABASE_URL missing"); process.exit(1); }
if (!process.env.ADMIN_GROUP_ID) { console.error("❌ ADMIN_GROUP_ID missing"); process.exit(1); }

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ DB connected"))
  .catch((err) => { console.error("❌ DB failed:", err); process.exit(1); });

async function initDatabase() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS students (telegram_id BIGINT PRIMARY KEY, first_name VARCHAR(255), username VARCHAR(255), minutes INTEGER DEFAULT 0, program VARCHAR(255), language VARCHAR(5) DEFAULT 'am', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS history (id SERIAL PRIMARY KEY, telegram_id BIGINT REFERENCES students(telegram_id) ON DELETE CASCADE, type VARCHAR(20) NOT NULL, minutes INTEGER NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, telegram_id BIGINT REFERENCES students(telegram_id) ON DELETE CASCADE, minutes INTEGER NOT NULL, period VARCHAR(50), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS age INTEGER;`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(10);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS reading_level VARCHAR(50);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS phone VARCHAR(30);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS reg_code VARCHAR(20);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS reg_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS schedule_days TEXT;`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS schedule_period VARCHAR(50);`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS schedule_time VARCHAR(50);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS memorization (id SERIAL PRIMARY KEY, telegram_id BIGINT REFERENCES students(telegram_id) ON DELETE CASCADE, memorized_what TEXT, memorized_where TEXT, center_name VARCHAR(255), teacher_name VARCHAR(255), memorization_date VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS recharge_requests (id SERIAL PRIMARY KEY, telegram_id BIGINT REFERENCES students(telegram_id) ON DELETE CASCADE, minutes INTEGER NOT NULL, price INTEGER NOT NULL, status VARCHAR(20) DEFAULT 'pending', approved_by BIGINT, approved_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS men_code_seq START 1;`);
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS women_code_seq START 1;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_memorization_tid ON memorization(telegram_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_recharge_tid ON recharge_requests(telegram_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_recharge_status ON recharge_requests(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_reg_code ON students(reg_code);`);
    console.log("✅ Tables ready");
  } catch (err) { console.error("❌ Init error:", err); }
}
initDatabase();

/* ============ Helpers ============ */
function t(lang, key, vars = {}) {
  const pack = locales[lang] || locales.am;
  let str = pack[key] || locales.am[key] || key;
  for (const k in vars) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
  return str;
}

async function getStudent(ctx) {
  const id = String(ctx.from.id);
  await pool.query(
    `INSERT INTO students (telegram_id, first_name, username) VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET first_name = $2, username = $3, updated_at = CURRENT_TIMESTAMP`,
    [id, ctx.from.first_name || "Student", ctx.from.username || ""]
  );
  const r = await pool.query("SELECT * FROM students WHERE telegram_id = $1", [id]);
  return r.rows[0];
}

function langOf(s) { return (s && s.language) || "am"; }

async function setLang(uid, lang) {
  await pool.query("UPDATE students SET language = $1 WHERE telegram_id = $2", [lang, String(uid)]);
}

async function addHistory(tid, type, minutes, description) {
  await pool.query(
    `INSERT INTO history (telegram_id, type, minutes, description) VALUES ($1, $2, $3, $4)`,
    [tid, type, minutes, description]
  );
}

async function generateRegCode(gender) {
  const seqName = gender === "male" ? "men_code_seq" : "women_code_seq";
  const prefix = gender === "male" ? "IM" : "IF";
  const r = await pool.query(`SELECT nextval('${seqName}') AS n`);
  const n = String(r.rows[0].n).padStart(3, "0");
  return `${prefix}-${n}`;
}

async function notifyAdmin(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_GROUP_ID, text, { parse_mode: "HTML" });
  } catch (err) { console.error("Admin notify failed:", err.message); }
}

async function isAdmin(ctx) {
  try {
    const member = await bot.telegram.getChatMember(ADMIN_GROUP_ID, ctx.from.id);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch { return false; }
}

async function findStudentByCode(code) {
  const r = await pool.query("SELECT * FROM students WHERE reg_code = $1", [code.toUpperCase()]);
  return r.rows[0];
}

/* ============ Sessions ============ */
const sessions = new Map();
function getSession(uid) { return sessions.get(String(uid)) || null; }
function setSession(uid, data) { sessions.set(String(uid), data); }
function clearSession(uid) { sessions.delete(String(uid)); }

/* ============ Reply Keyboard (أزرار ثابتة أسفل الشاشة) ============ */
function replyKeyboard() {
  return Markup.keyboard([
    [
      Markup.button.text("📋 القائمة"),
      Markup.button.text("👤 حسابي")
    ]
  ]).resize();
}

/* ============ Inline Menus ============ */
function languageMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🇪🇹 አማርኛ", "setlang_am")],
    [Markup.button.callback("🇸🇦 العربية", "setlang_ar")],
    [Markup.button.callback("🇬🇧 English", "setlang_en")]
  ]);
}

function mainMenu(lang, registered) {
  const rows = [];
  if (!registered) rows.push([Markup.button.callback(t(lang, "btnRegister"), "register")]);
  rows.push([Markup.button.callback(t(lang, "btnPrograms"), "programs"), Markup.button.callback(t(lang, "btnTeachers"), "teachers")]);
  rows.push([Markup.button.callback(t(lang, "btnBalance"), "balance"), Markup.button.callback(t(lang, "btnBuy"), "packages")]);
  rows.push([Markup.button.callback(t(lang, "btnBooking"), "booking"), Markup.button.callback(t(lang, "btnAccount"), "account")]);
  rows.push([Markup.button.callback(t(lang, "btnBooks"), "books"), Markup.button.callback(t(lang, "btnAudio"), "audio")]);
  rows.push([Markup.button.callback(t(lang, "btnCertificates"), "certificates"), Markup.button.callback(t(lang, "btnSupport"), "support")]);
  rows.push([Markup.button.callback(t(lang, "btnChangeLang"), "choose_lang")]);
  return Markup.inlineKeyboard(rows);
}

/* ============ Start ============ */
bot.start(async (ctx) => {
  try {
    const s = await getStudent(ctx);
    const lang = langOf(s);
    await ctx.reply(t(lang, "welcome", { name: s.first_name }), {
      parse_mode: "HTML"
    });
    await ctx.reply(t(lang, "homeWelcome"), {
      parse_mode: "HTML",
      ...mainMenu(lang, s.is_registered)
    });
    await ctx.reply("📌 للتنقل السريع استخدم الأزرار أدناه:", replyKeyboard());
  } catch (err) {
    console.error("Start error:", err);
  }
});

/* ============ Language ============ */
bot.action("choose_lang", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  await ctx.editMessageText(t(langOf(s), "chooseLang"), languageMenu());
});

bot.action(/^setlang_(am|ar|en)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const lang = ctx.match[1];
  await setLang(ctx.from.id, lang);
  const s = await getStudent(ctx);
  await ctx.editMessageText(t(lang, "langSaved"), {
    parse_mode: "HTML", ...mainMenu(lang, s.is_registered)
  });
});

bot.action("home", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "homeWelcome"), {
    parse_mode: "HTML", ...mainMenu(lang, s.is_registered)
  });
});

/* ============ Registration ============ */
bot.action("register", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  if (s.is_registered) {
    return ctx.editMessageText(t(lang, "regAlreadyRegistered", { code: s.reg_code }), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
    });
  }
  setSession(ctx.from.id, { step: "name", data: {} });
  await ctx.editMessageText(t(lang, "regWelcome"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "regStartBtn"), "reg_step_name")],
      [Markup.button.callback(t(lang, "regCancelBtn"), "reg_cancel")]
    ])
  });
});

bot.action("reg_cancel", async (ctx) => {
  await ctx.answerCbQuery();
  clearSession(ctx.from.id);
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "regCanceled"), {
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
  });
});

bot.action("reg_step_name", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  setSession(ctx.from.id, { step: "name", data: {} });
  await ctx.editMessageText(t(lang, "regAskName"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "regCancelBtn"), "reg_cancel")]])
  });
});

/* ============ Registration text handler ============ */
bot.on("text", async (ctx, next) => {
  const session = getSession(ctx.from.id);
  if (!session) return next();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return next();

  switch (session.step) {
    case "name":
      session.data.name = text;
      session.step = "age";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskAge"), { parse_mode: "HTML" });

    case "age": {
      const age = parseInt(text);
      if (isNaN(age) || age < 10 || age > 100) return ctx.reply(t(lang, "regInvalidAge"));
      session.data.age = age;
      session.step = "gender";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskGender"), {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(t(lang, "regGenderMale"), "reg_g_male")],
          [Markup.button.callback(t(lang, "regGenderFemale"), "reg_g_female")]
        ])
      });
    }

    case "phone":
      if (text.length < 8) return ctx.reply(t(lang, "regInvalidPhone"));
      session.data.phone = text;
      session.step = "memorized_what";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskMemorizedWhat"), { parse_mode: "HTML" });

    case "memorized_what":
      session.data.memorized_what = text;
      session.step = "memorized_where";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskMemorizedWhere"), { parse_mode: "HTML" });

    case "memorized_where":
      session.data.memorized_where = text;
      session.step = "center";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskCenter"), { parse_mode: "HTML" });

    case "center":
      session.data.center = text;
      session.step = "teacher";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskTeacher"), { parse_mode: "HTML" });

    case "teacher":
      session.data.teacher = text;
      session.step = "date";
      setSession(ctx.from.id, session);
      return ctx.reply(t(lang, "regAskDate"), { parse_mode: "HTML" });

    case "date":
      session.data.date = text;
      session.step = "confirm";
      setSession(ctx.from.id, session);
      return showRegConfirm(ctx, lang, session.data);
  }
  return next();
});

async function showRegConfirm(ctx, lang, d) {
  const sched = d.gender === "male" ? schedules.schedules.men : schedules.schedules.women;
  const periodLabel = d.period || "";
  const text = t(lang, "regConfirm", {
    name: d.name, age: d.age, gender: d.gender === "male" ? "ذكر" : "أنثى",
    level: d.level, phone: d.phone,
    memorized_what: d.memorized_what, memorized_where: d.memorized_where,
    center: d.center, teacher: d.teacher, date: d.date,
    days: sched.days.join("، "), period: periodLabel
  });
  await ctx.reply(text, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "regConfirmBtn"), "reg_confirm")],
      [Markup.button.callback(t(lang, "regCancelBtn"), "reg_cancel")]
    ])
  });
}

bot.action(/^reg_g_(male|female)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  if (!session) return;
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const gender = ctx.match[1];
  session.data.gender = gender;
  session.step = "level";
  setSession(ctx.from.id, session);
  await ctx.editMessageText(t(lang, "regAskLevel"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "regLevel1"), "reg_l_1")],
      [Markup.button.callback(t(lang, "regLevel2"), "reg_l_2")],
      [Markup.button.callback(t(lang, "regLevel3"), "reg_l_3")],
      [Markup.button.callback(t(lang, "regLevel4"), "reg_l_4")]
    ])
  });
});

bot.action(/^reg_l_(\d)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  if (!session) return;
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const levels = { "1": "مبتدئ", "2": "متوسط", "3": "متقدم", "4": "حافظ/مجيد" };
  session.data.level = levels[ctx.match[1]];
  session.step = "phone";
  setSession(ctx.from.id, session);
  await ctx.editMessageText(t(lang, "regAskPhone"), { parse_mode: "HTML" });
});

bot.action("reg_confirm", async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx.from.id);
  if (!session) return;
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const d = session.data;
  const sched = d.gender === "male" ? schedules.schedules.men : schedules.schedules.women;
  const code = await generateRegCode(d.gender);

  await pool.query(
    `UPDATE students SET age=$1, gender=$2, reading_level=$3, phone=$4, reg_code=$5, is_registered=TRUE, status='active', schedule_days=$6, schedule_period=$7 WHERE telegram_id=$8`,
    [d.age, d.gender, d.level, d.phone, code, sched.days.join("، "), d.period || "", String(ctx.from.id)]
  );

  await pool.query(
    `INSERT INTO memorization (telegram_id, memorized_what, memorized_where, center_name, teacher_name, memorization_date) VALUES ($1,$2,$3,$4,$5,$6)`,
    [String(ctx.from.id), d.memorized_what, d.memorized_where, d.center, d.teacher, d.date]
  );

  clearSession(ctx.from.id);

  const dateStr = new Date().toLocaleDateString("ar-EG");
  await ctx.editMessageText(t(lang, "regDone", { code, date: dateStr }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
  });

  await notifyAdmin(t("ar", "notifyNewRegistration", {
    name: d.name, age: d.age, gender: d.gender === "male" ? "ذكر" : "أنثى",
    phone: d.phone, level: d.level, code, tid: ctx.from.id,
    memorized_what: d.memorized_what, days: sched.days.join("، "), period: d.period || ""
  }));
});

/* ============ Programs ============ */
bot.action("programs", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "programs"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "progNorania"), "prog_norania")],
      [Markup.button.callback(t(lang, "progNazr"), "prog_nazr"), Markup.button.callback(t(lang, "progHifz"), "prog_hifz")],
      [Markup.button.callback(t(lang, "progHafs"), "prog_hafs")],
      [Markup.button.callback(t(lang, "progSeven"), "prog_seven"), Markup.button.callback(t(lang, "progTen"), "prog_ten")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

bot.action("prog_norania", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await pool.query("UPDATE students SET program=$1 WHERE telegram_id=$2", ["القاعدة النورانية", String(ctx.from.id)]);
  await ctx.editMessageText(t(lang, "noraniaTitle") + "\n\n" + t(lang, "noraniaBody"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "lessonsBtn"), "norania_lessons")],
      [Markup.button.callback(t(lang, "bookSessionBtn"), "booking")],
      [Markup.button.callback(t(lang, "backPrograms"), "programs")]
    ])
  });
});

bot.action("norania_lessons", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "lessonsTitle") + (t(lang, "lessonsNote") || ""), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("1", "lesson_1"), Markup.button.callback("2", "lesson_2"), Markup.button.callback("3", "lesson_3")],
      [Markup.button.callback("4", "lesson_4"), Markup.button.callback("5", "lesson_5"), Markup.button.callback("6", "lesson_6")],
      [Markup.button.callback("7", "lesson_7"), Markup.button.callback("8", "lesson_8")],
      [Markup.button.callback(t(lang, "backPrograms"), "prog_norania")]
    ])
  });
});

bot.action(/^lesson_(\d)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const n = ctx.match[1];
  await ctx.editMessageText(t(lang, "lessonTitle", { n }) + "\n\n" + t(lang, "lessonBody"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "bookWithTeacherBtn"), "booking")],
      [Markup.button.callback(t(lang, "backLessons"), "norania_lessons")]
    ])
  });
});

async function simpleProgram(ctx, titleKey, bodyKey, program) {
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await pool.query("UPDATE students SET program=$1 WHERE telegram_id=$2", [program, String(ctx.from.id)]);
  await ctx.editMessageText(t(lang, titleKey) + "\n\n" + t(lang, bodyKey), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "chooseTeacherBtn"), "teachers")],
      [Markup.button.callback(t(lang, "bookSessionBtn"), "booking")],
      [Markup.button.callback(t(lang, "backPrograms"), "programs")]
    ])
  });
}

bot.action("prog_nazr", async (ctx) => { await ctx.answerCbQuery(); await simpleProgram(ctx, "nazrTitle", "nazrBody", "التلاوة والنظر"); });
bot.action("prog_hifz", async (ctx) => { await ctx.answerCbQuery(); await simpleProgram(ctx, "hifzTitle", "hifzBody", "الحفظ"); });
bot.action("prog_hafs", async (ctx) => { await ctx.answerCbQuery(); await simpleProgram(ctx, "hafsTitle", "hafsBody", "حفص والإجازة"); });
bot.action("prog_seven", async (ctx) => { await ctx.answerCbQuery(); await simpleProgram(ctx, "sevenTitle", "sevenBody", "القراءات السبع"); });
bot.action("prog_ten", async (ctx) => { await ctx.answerCbQuery(); await simpleProgram(ctx, "tenTitle", "tenBody", "القراءات العشر"); });

/* ============ Teachers ============ */
bot.action("teachers", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "teachers"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "teacherAbuZaid"), "teacher_abuzaid")],
      [Markup.button.callback(t(lang, "salafiScholarsBtn"), "salafi_list")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

bot.action("teacher_abuzaid", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const sched = schedules.schedules.men;
  const schedText = `${sched.days.join("، ")}\n${sched.periods.map(p => `• ${p.label}: ${p.time}`).join("\n")}`;
  await ctx.editMessageText(t(lang, "teacherAbuZaidBody", { schedule: schedText }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "bookSessionBtn"), "booking")],
      [Markup.button.callback(t(lang, "backTeachers"), "teachers")]
    ])
  });
});

bot.action("salafi_list", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const rows = schedules.salafiScholars.map(sc => [Markup.button.callback(sc.name, `salafi_${sc.id}`)]);
  rows.push([Markup.button.callback(t(lang, "backTeachers"), "teachers")]);
  await ctx.editMessageText(t(lang, "salafiTitle"), { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
});

bot.action(/^salafi_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const sc = schedules.salafiScholars.find(x => x.id === ctx.match[1]);
  if (!sc) return;
  const rows = [[Markup.button.url(t(lang, "openChannelBtn"), sc.channel)]];
  if (sc.extra) rows.push([Markup.button.url(sc.extra.title, sc.extra.url)]);
  rows.push([Markup.button.callback(t(lang, "backSalafi"), "salafi_list")]);
  await ctx.editMessageText(t(lang, "salafiBody", { name: sc.name, description: sc.description }), {
    parse_mode: "HTML", ...Markup.inlineKeyboard(rows)
  });
});

/* ============ Books ============ */
bot.action("books", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const rows = schedules.books.map(b => [Markup.button.callback(b.title, `book_${b.id}`)]);
  rows.push([Markup.button.callback(t(lang, "btnHome"), "home")]);
  await ctx.editMessageText(t(lang, "booksTitle"), { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
});

bot.action(/^book_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const b = schedules.books.find(x => x.id === ctx.match[1]);
  if (!b) return;
  const rows = [[Markup.button.url(t(lang, "downloadBtn"), b.url)]];
  if (schedules.matnExplanations[b.id]) {
    rows.push([Markup.button.callback(t(lang, "watchExplanationBtn"), `explain_${b.id}`)]);
  }
  rows.push([Markup.button.callback(t(lang, "backBooks"), "books")]);
  await ctx.editMessageText(`📖 <b>${b.title}</b>`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
});

bot.action(/^explain_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const e = schedules.matnExplanations[ctx.match[1]];
  if (!e) return;
  await ctx.editMessageText(t(lang, "explanationTitle", { title: e.title, count: e.count }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.url(t(lang, "watchNowBtn"), e.playlist)],
      [Markup.button.callback(t(lang, "backBooks"), "books")]
    ])
  });
});

/* ============ Audio ============ */
bot.action("audio", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const rows = schedules.lectures.slice(0, 8).map(l => [Markup.button.callback(l.title, `lec_${l.id}`)]);
  rows.push([Markup.button.callback(t(lang, "btnHome"), "home")]);
  await ctx.editMessageText(t(lang, "audioTitle"), { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
});

bot.action(/^lec_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const l = schedules.lectures.find(x => x.id === ctx.match[1]);
  if (!l) return;
  await ctx.editMessageText(t(lang, "audioBody", { title: l.title }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.url(t(lang, "watchNowBtn"), l.url)],
      [Markup.button.callback(t(lang, "backAudio"), "audio")]
    ])
  });
});

/* ============ Balance ============ */
bot.action("balance", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "balanceBody", {
    name: s.first_name, minutes: s.minutes, value: s.minutes * 5
  }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "btnBuy"), "packages")],
      [Markup.button.callback(t(lang, "historyBtn"), "history")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

bot.action("history", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const r = await pool.query(`SELECT * FROM history WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 10`, [String(ctx.from.id)]);
  if (!r.rows.length) {
    return ctx.editMessageText(t(lang, "historyTitle") + "\n\n" + t(lang, "historyEmpty"), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "backBalance"), "balance")]])
    });
  }
  let txt = t(lang, "historyTitle") + "\n\n";
  r.rows.forEach(i => {
    const sign = i.type === "credit" ? "+" : "-";
    const date = new Date(i.created_at).toLocaleString("ar-EG");
    txt += `${date}\n${i.description}\n${sign}${i.minutes}\n────────\n`;
  });
  await ctx.editMessageText(txt, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "backBalance"), "balance")]])
  });
});

/* ============ Packages ============ */
const packages = [
  { minutes: 100, price: 500 }, { minutes: 200, price: 1000 },
  { minutes: 300, price: 1470 }, { minutes: 400, price: 1920 },
  { minutes: 500, price: 2350 }, { minutes: 600, price: 2760 },
  { minutes: 1000, price: 4500 }
];

bot.action("packages", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const rows = packages.map(p => [Markup.button.callback(`${p.minutes} — ${p.price} ETB`, `buy_${p.minutes}`)]);
  rows.push([Markup.button.callback(t(lang, "btnHome"), "home")]);
  await ctx.editMessageText(t(lang, "buyTitle") + "\n\n" + t(lang, "buyBody"), { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
});

bot.action(/^buy_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const m = Number(ctx.match[1]);
  const p = packages.find(x => x.minutes === m);
  if (!p) return;
  await ctx.editMessageText(t(lang, "confirmPackBody", { minutes: p.minutes, price: p.price }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "wantBuyBtn"), `confirm_buy_${p.minutes}`)],
      [Markup.button.callback(t(lang, "backPackages"), "packages")]
    ])
  });
});

bot.action(/^confirm_buy_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const m = Number(ctx.match[1]);
  const p = packages.find(x => x.minutes === m);
  if (!p) return;
  const r = await pool.query(
    `INSERT INTO recharge_requests (telegram_id, minutes, price) VALUES ($1,$2,$3) RETURNING id`,
    [String(ctx.from.id), p.minutes, p.price]
  );
  const reqId = r.rows[0].id;
  setSession(ctx.from.id, { step: "receipt", data: { reqId, minutes: p.minutes, price: p.price } });
  await ctx.editMessageText(t(lang, "purchaseRequested"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
  });
});

bot.on("photo", async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session || session.step !== "receipt") return;
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const { reqId, minutes, price } = session.data;
  try {
    await bot.telegram.forwardMessage(ADMIN_GROUP_ID, ctx.chat.id, ctx.message.message_id);
    await notifyAdmin(t("ar", "notifyNewReceipt", {
      name: s.first_name, code: s.reg_code || "—", price, minutes, reqId
    }));
  } catch (e) { console.error(e); }
  clearSession(ctx.from.id);
  await ctx.reply(t(lang, "receiptReceived"), { parse_mode: "HTML" });
});

/* ============ Booking ============ */
bot.action("booking", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  if (s.minutes <= 0) {
    return ctx.editMessageText(t(lang, "noBalanceWarning") + "\n\n" + t(lang, "noBalanceBody", { minutes: s.minutes }), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback(t(lang, "btnBuy"), "packages")],
        [Markup.button.callback(t(lang, "btnHome"), "home")]
      ])
    });
  }
  await ctx.editMessageText(t(lang, "bookingTitle") + "\n\n" + t(lang, "bookingBody", { minutes: s.minutes }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "min15"), "bk_15"), Markup.button.callback(t(lang, "min20"), "bk_20")],
      [Markup.button.callback(t(lang, "min30"), "bk_30"), Markup.button.callback(t(lang, "min45"), "bk_45")],
      [Markup.button.callback(t(lang, "min60"), "bk_60")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

bot.action(/^bk_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const m = Number(ctx.match[1]);
  if (s.minutes < m) return ctx.reply(t(lang, "notEnoughBalance", { minutes: s.minutes, requested: m }));
  await ctx.editMessageText(t(lang, "chooseSessionTime"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "morning"), `bkp_${m}_morning`)],
      [Markup.button.callback(t(lang, "afternoon"), `bkp_${m}_afternoon`)],
      [Markup.button.callback(t(lang, "night"), `bkp_${m}_night`)],
      [Markup.button.callback(t(lang, "backBooking"), "booking")]
    ])
  });
});

bot.action(/^bkp_(\d+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const m = Number(ctx.match[1]);
  const period = ctx.match[2];
  await pool.query("UPDATE students SET minutes = minutes - $1 WHERE telegram_id = $2", [m, String(ctx.from.id)]);
  await addHistory(String(ctx.from.id), "debit", m, `حجز جلسة (${period})`);
  await pool.query(`INSERT INTO bookings (telegram_id, minutes, period) VALUES ($1,$2,$3)`, [String(ctx.from.id), m, period]);
  const updated = await getStudent(ctx);
  await ctx.editMessageText(t(lang, "bookingConfirmedBody", { minutes: m, remaining: updated.minutes }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
  });
  await notifyAdmin(t("ar", "notifyNewBooking", { name: s.first_name, code: s.reg_code || "—", minutes: m, period }));
});

/* ============ Account ============ */
bot.action("account", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  const date = s.reg_date ? new Date(s.reg_date).toLocaleDateString("ar-EG") : "—";
  await ctx.editMessageText(t(lang, "accountBody", {
    name: s.first_name, code: s.reg_code || "—", age: s.age || "—",
    gender: s.gender === "male" ? "ذكر" : s.gender === "female" ? "أنثى" : "—",
    level: s.reading_level || "—", phone: s.phone || "—",
    minutes: s.minutes, program: s.program || t(lang, "noProgram"),
    days: s.schedule_days || "—", period: s.schedule_period || "—", reg_date: date
  }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, "chooseProgramBtn"), "programs")],
      [Markup.button.callback(t(lang, "btnBalance"), "balance")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

/* ============ Certificates ============ */
bot.action("certificates", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "certificatesTitle") + "\n\n" + t(lang, "certificatesBody"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, "btnHome"), "home")]])
  });
});

/* ============ Support ============ */
bot.action("support", async (ctx) => {
  await ctx.answerCbQuery();
  const s = await getStudent(ctx);
  const lang = langOf(s);
  await ctx.editMessageText(t(lang, "supportTitle") + "\n\n" + t(lang, "supportBody"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.url(t(lang, "contactTelegram"), "https://t.me/aljezer_241")],
      [Markup.button.callback(t(lang, "btnHome"), "home")]
    ])
  });
});

/* ============ Admin Commands ============ */
bot.command("help", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  await ctx.reply(t("ar", "adminHelp"), { parse_mode: "HTML" });
});

bot.command("add", async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(t("ar", "adminNotAuthorized"));
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply(t("ar", "adminInvalidArgs"));
  const [code, mins] = args;
  const st = await findStudentByCode(code);
  if (!st) return ctx.reply(t("ar", "adminStudentNotFound"));
  await pool.query("UPDATE students SET minutes = minutes + $1 WHERE telegram_id = $2", [Number(mins), st.telegram_id]);
  await addHistory(st.telegram_id, "credit", Number(mins), `شحن من الإدارة (${ctx.from.first_name})`);
  const updated = await pool.query("SELECT * FROM students WHERE telegram_id = $1", [st.telegram_id]);
  const msg = t("ar", "adminMinutesAdded", { name: st.first_name, code, minutes: mins, total: updated.rows[0].minutes });
  await ctx.reply(msg, { parse_mode: "HTML" });
  try { await bot.telegram.sendMessage(st.telegram_id, t("ar", "rechargeApproved", { minutes: mins, price: Number(mins) * 5, total: updated.rows[0].minutes }), { parse_mode: "HTML" }); } catch {}
});

bot.command("remove", async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(t("ar", "adminNotAuthorized"));
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply(t("ar", "adminInvalidArgs"));
  const [code, mins] = args;
  const st = await findStudentByCode(code);
  if (!st) return ctx.reply(t("ar", "adminStudentNotFound"));
  await pool.query("UPDATE students SET minutes = GREATEST(minutes - $1, 0) WHERE telegram_id = $2", [Number(mins), st.telegram_id]);
  await addHistory(st.telegram_id, "debit", Number(mins), `خصم من الإدارة (${ctx.from.first_name})`);
  const updated = await pool.query("SELECT * FROM students WHERE telegram_id = $1", [st.telegram_id]);
  await ctx.reply(t("ar", "adminMinutesRemoved", { name: st.first_name, code, minutes: mins, total: updated.rows[0].minutes }), { parse_mode: "HTML" });
});

bot.command("info", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const code = ctx.message.text.split(/\s+/)[1];
  if (!code) return ctx.reply(t("ar", "adminInvalidArgs"));
  const st = await findStudentByCode(code);
  if (!st) return ctx.reply(t("ar", "adminStudentNotFound"));
  const mem = await pool.query("SELECT * FROM memorization WHERE telegram_id=$1 LIMIT 1", [st.telegram_id]);
  const m = mem.rows[0] || {};
  const date = st.reg_date ? new Date(st.reg_date).toLocaleDateString("ar-EG") : "—";
  await ctx.reply(t("ar", "adminInfo", {
    code, name: st.first_name, age: st.age || "—",
    gender: st.gender === "male" ? "ذكر" : st.gender === "female" ? "أنثى" : "—",
    phone: st.phone || "—", level: st.reading_level || "—",
    memorized_what: m.memorized_what || "—", center: m.center_name || "—",
    teacher: m.teacher_name || "—", minutes: st.minutes, reg_date: date, tid: st.telegram_id
  }), { parse_mode: "HTML" });
});

bot.command("pending", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const r = await pool.query("SELECT * FROM recharge_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 20");
  if (!r.rows.length) return ctx.reply(t("ar", "adminNoPending"));
  let txt = "📋 طلبات معلقة:\n\n";
  for (const row of r.rows) {
    const st = await pool.query("SELECT * FROM students WHERE telegram_id=$1", [row.telegram_id]);
    const name = st.rows[0]?.first_name || "—";
    txt += `🆔 <code>${row.id}</code> — ${name}\n${row.minutes} دقيقة — ${row.price} ETB\n────────\n`;
  }
  await ctx.reply(txt, { parse_mode: "HTML" });
});

bot.command("approve", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const id = parseInt(ctx.message.text.split(/\s+/)[1]);
  if (!id) return;
  const r = await pool.query("SELECT * FROM recharge_requests WHERE id=$1 AND status='pending'", [id]);
  if (!r.rows.length) return ctx.reply("❌ لا يوجد طلب معلق بهذا الرقم.");
  const req = r.rows[0];
  await pool.query("UPDATE recharge_requests SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2", [ctx.from.id, id]);
  await pool.query("UPDATE students SET minutes = minutes + $1 WHERE telegram_id = $2", [req.minutes, req.telegram_id]);
  await addHistory(req.telegram_id, "credit", req.minutes, `شحن معتمد #${id}`);
  const upd = await pool.query("SELECT minutes FROM students WHERE telegram_id=$1", [req.telegram_id]);
  await ctx.reply(t("ar", "adminApproved"));
  try {
    await bot.telegram.sendMessage(req.telegram_id, t("ar", "rechargeApproved", {
      minutes: req.minutes, price: req.price, total: upd.rows[0].minutes
    }), { parse_mode: "HTML" });
  } catch {}
});

bot.command("reject", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const id = parseInt(ctx.message.text.split(/\s+/)[1]);
  if (!id) return;
  const r = await pool.query("SELECT * FROM recharge_requests WHERE id=$1 AND status='pending'", [id]);
  if (!r.rows.length) return;
  await pool.query("UPDATE recharge_requests SET status='rejected', approved_by=$1, approved_at=NOW() WHERE id=$2", [ctx.from.id, id]);
  await ctx.reply(t("ar", "adminRejected"));
  try { await bot.telegram.sendMessage(r.rows[0].telegram_id, t("ar", "rechargeRejected", { reason: "—" }), { parse_mode: "HTML" }); } catch {}
});

bot.command("reply", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) return ctx.reply("⚠️ استخدم: /reply CODE MESSAGE");
  const code = parts[0];
  const message = parts.slice(1).join(" ");
  const st = await findStudentByCode(code);
  if (!st) return ctx.reply(t("ar", "adminStudentNotFound"));
  try { await bot.telegram.sendMessage(st.telegram_id, `📩 <b>رسالة من الإدارة:</b>\n\n${message}`, { parse_mode: "HTML" }); } catch {}
  await ctx.reply(t("ar", "adminReplied"));
});

bot.command("broadcast", async (ctx) => {
  if (!await isAdmin(ctx)) return;
  const message = ctx.message.text.split(/\s+/).slice(1).join(" ");
  if (!message) return;
  const r = await pool.query("SELECT telegram_id FROM students WHERE is_registered=TRUE");
  let count = 0;
  for (const row of r.rows) {
    try { await bot.telegram.sendMessage(row.telegram_id, `📢 <b>إشعار:</b>\n\n${message}`, { parse_mode: "HTML" }); count++; } catch {}
  }
  await ctx.reply(t("ar", "adminBroadcastSent", { count }));
});

/* ============ Generic text ============ */
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const s = await getStudent(ctx);
  const lang = langOf(s);

  if (text === "📋 القائمة") {
    return ctx.reply(t(lang, "homeWelcome"), {
      parse_mode: "HTML",
      ...mainMenu(lang, s.is_registered)
    });
  }

  if (text === "👤 حسابي") {
    const date = s.reg_date ? new Date(s.reg_date).toLocaleDateString("ar-EG") : "—";
    return ctx.reply(t(lang, "accountBody", {
      name: s.first_name, code: s.reg_code || "—", age: s.age || "—",
      gender: s.gender === "male" ? "ذكر" : s.gender === "female" ? "أنثى" : "—",
      level: s.reading_level || "—", phone: s.phone || "—",
      minutes: s.minutes, program: s.program || t(lang, "noProgram"),
      days: s.schedule_days || "—", period: s.schedule_period || "—", reg_date: date
    }), {
      parse_mode: "HTML",
      ...mainMenu(lang, s.is_registered)
    });
  }

  await ctx.reply(t(lang, "anyTextWelcome"), { ...mainMenu(lang, s.is_registered) });
});

/* ============ Errors ============ */
bot.catch((err, ctx) => {
  console.error("Bot Error:", err);
});

/* ============ Web ============ */
app.get("/", (req, res) => res.send(`<html dir="rtl"><head><meta charset="UTF-8"><title>مقرأة الإمام الجزري</title></head><body style="font-family:Arial;text-align:center;padding:50px"><h1>📖 مقرأة الإمام الجزري</h1><p>🤖 البوت يعمل بنجاح</p></body></html>`));
app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", db: "connected" }); }
  catch { res.status(500).json({ status: "error" }); }
});

app.listen(PORT, () => console.log(`Web running on ${PORT}`));

bot.launch().then(() => console.log("🤖 Bot running...")).catch(e => console.error("❌", e));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));