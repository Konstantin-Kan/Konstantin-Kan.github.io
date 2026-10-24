(() => {
'use strict';

const C = window.SCHOOL_CONFIG || {};
const DEMO = !C.SUPABASE_URL;

// ---------- Мелочи ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const fmt = d => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const ytId = v => {
  v = String(v || '').trim();
  const m = v.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(v) ? v : '');
};
const toast = msg => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
};
const HW = {
  new: ['На проверке', 'warn'],
  redo: ['На доработку', 'bad'],
  passed: ['Сдал ✓', 'ok']
};
// Фото к домашке: уменьшаем в браузере, чтобы грузилось быстро и не забивало место
const MAX_SHOTS = 10;
async function shrink(file, max = 1600) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((ok, no) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file);
    }).catch(() => null);
  }
  if (!img) throw new Error(`Не получилось открыть «${file.name}». Пришли JPG, PNG или скриншот`);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
}
const shots = (files, urls) => (files || []).length ? `<div class="shots">${files.map(f => urls[f.path]
  ? `<a href="${esc(urls[f.path])}" target="_blank" rel="noopener" title="${esc(f.name || '')}"><img src="${esc(urls[f.path])}" alt="" loading="lazy"></a>`
  : '<span class="shot-miss">фото</span>').join('')}</div>` : '';
const hwPill = s => s && HW[s] ? `<span class="pill ${HW[s][1]}">${HW[s][0]}</span>` : '';

// ---------- Материалы: скачивание одной кнопкой ----------
const fileExt = m => m.ext || ((m.name || m.url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
const EXT = { pdf: ['PDF', '#e0261b'], doc: ['DOC', '#2b5797'], docx: ['DOC', '#2b5797'], xls: ['XLS', '#1d7044'], xlsx: ['XLS', '#1d7044'],
  ppt: ['PPT', '#c4441c'], pptx: ['PPT', '#c4441c'], zip: ['ZIP', '#6e6e73'], jpg: ['JPG', '#8e44ad'], png: ['PNG', '#8e44ad'] };
const fmtSize = b => !b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
// Ссылку Google Диска / Документов превращаем в прямое скачивание, без захода на Диск
function dlUrl(u) {
  u = String(u || '').trim();
  let m = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=${{ document: 'docx', spreadsheets: 'xlsx', presentation: 'pptx' }[m[1]]}`;
  m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return u;
}
function saveAs(href, name) {
  const a = document.createElement('a');
  a.href = href; if (name) a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
}

// ============================================================
// Данные: демо (в браузере) или Supabase
// ============================================================

function demoApi() {
  const KEY = 'school_demo_v4';
  const MATS = {
    1: ['Памятка ученика — Казахстан:pdf', 'Памятка ученика — Корея:pdf', 'Книга техник продаж:pdf', 'Таблица учёта клиентов:xlsx',
        'Таблица — пример заполнения:xlsx', 'Анкета точки А:docx', 'Гайд до старта:pdf', 'Рабочая тетрадь:docx'],
    2: ['Рабочая тетрадь:docx'], 3: ['Рабочая тетрадь:docx'], 4: ['Рабочая тетрадь:docx'], 5: ['Гайд до старта:pdf']
  };
  const L = (id, position, title, needs_homework, blocks, homework, body = '') => ({
    id, course_id: 1, position, module: 'Модуль 1 · Работаем с головой', title, needs_homework,
    published: true, body, homework,
    blocks: blocks.map(t => ({ title: t, video: '' })),
    materials: (MATS[id] || []).map(t => { const [title, ext] = t.split(':'); return { title, ext }; })
  });
  // Файлы материалов в демо лежат в этом браузере (IndexedDB), наружу не уходят
  const idb = (() => {
    let p;
    const open = () => p ||= new Promise((ok, no) => {
      const r = indexedDB.open('school_demo_files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('f');
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
    const tx = async (mode, fn) => {
      const d = await open();
      return new Promise((ok, no) => {
        const t = d.transaction('f', mode), r = fn(t.objectStore('f'));
        t.oncomplete = () => ok(r.result); t.onerror = () => no(t.error);
      });
    };
    return { put: (k, v) => tx('readwrite', s => s.put(v, k)), get: k => tx('readonly', s => s.get(k)) };
  })();
  const seed = () => ({
    seq: 100, session: null,
    users: [
      { id: 'u-admin', email: 'admin@demo', pw: 'demo' },
      { id: 'u-student', email: 'student@demo', pw: 'demo' }
    ],
    profiles: [
      { id: 'u-admin', email: 'admin@demo', name: 'Константин', role: 'admin', phone: '', telegram: '', created_at: new Date().toISOString() },
      { id: 'u-student', email: 'student@demo', name: 'Демо-ученик', role: 'student', phone: '+7 700 000 00 00', telegram: '@demo', package: 'стандарт', paid: '', note: '', created_at: new Date().toISOString() }
    ],
    courses: [{ id: 1, title: 'Sky — обучение продажам', description: 'Обучение продажам: 2 месяца. Уроки открываются по очереди, после проверки домашки.', position: 1, published: true }],
    lessons: [
      L(1, 0, 'Вступление к курсу', false, ['Вступление'], null,
        'Держи рядом рабочую тетрадь. Когда я говорю «поставь на паузу» — ставь на паузу и пиши. Не потом, а сразу.\nИ ещё одно правило: 15 минут на продажи каждый день.'),
      L(2, 1, 'Урок 1.1 — Что ты думаешь о продажах', true,
        ['Откуда стыд продавать', 'Продавец помогает купить', 'Оба выиграли', 'Молчать нечестно'],
        'Первое. Тетрадь, пункт 1.1. Выпиши пять своих мыслей про продажи, которые тебе мешают.\nВторое. На каждую мысль посмотри с другой стороны — с позиции пользы для клиента. Что получит человек, если ты ему предложишь? Пропиши ответ на языке выгоды.'),
      L(3, 2, 'Урок 1.2 — Деньги и стыд', true,
        ['Деньги из детства', 'Стыд и два страха', 'Иди туда, где страшно', 'Отказ — не про тебя'],
        'Тетрадь, пункт 1.2. Вспомни три ситуации, когда тебе было стыдно предложить или назвать цену. Чего было страшно? И что было на самом деле?\nИ выпиши фразы про деньги, которые звучали у тебя в детстве.'),
      L(4, 3, 'Урок 1.3 — Уверенность', true,
        ['Что клиент считывает', 'Знай и цени свой продукт', 'Круг забот и круг влияния', 'Не жди уверенности'],
        'Первое. Тетрадь, пункт 1.3. Пропиши три результата своих клиентов.\nВторое. Круг забот и круг влияния — два столбика.\nТретье. Перепиши три последних сообщения клиентам без «извините» и оправданий.'),
      L(5, 4, 'Трафик — Шапка профиля', true,
        ['Зачем шапка и откуда текст', 'Что писать в шапке', 'Убираем лишнее', 'Результат, а не услуги'],
        'Сожми адресное предложение в шапку из трёх строк. Поправь имя профиля под поиск, скрой категорию, убери адрес и список услуг.')
    ],
    enrollments: [{ user_id: 'u-student', course_id: 1, access_until: null }],
    progress: [], homework: [], comments: [], files: {}
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  db.files = db.files || {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const id = () => ++db.seq;
  const now = () => new Date().toISOString();
  const me = () => db.profiles.find(p => p.id === db.session);
  const isAdmin = () => me()?.role === 'admin';
  const prof = uid => db.profiles.find(p => p.id === uid) || {};
  const lessonOpen = (lid, uid) => {
    const l = db.lessons.find(x => x.id === lid);
    if (!l || !l.published) return false;
    const e = db.enrollments.find(x => x.user_id === uid && x.course_id === l.course_id);
    if (!e || (e.access_until && e.access_until < now().slice(0, 10))) return false;
    return !db.lessons.some(p => p.course_id === l.course_id && p.published && p.needs_homework &&
      p.position < l.position && !db.progress.some(g => g.lesson_id === p.id && g.user_id === uid));
  };
  const canSee = lid => isAdmin() || lessonOpen(lid, db.session);
  const ok = v => Promise.resolve(JSON.parse(JSON.stringify(v ?? null)));
  const fail = m => Promise.reject(new Error(m));

  return {
    demo: true,
    reset() { localStorage.removeItem(KEY); try { indexedDB.deleteDatabase('school_demo_files'); } catch {} location.hash = '#/'; location.reload(); },
    async session() {
      const p = me(); return p ? { user: { id: p.id, email: p.email }, profile: { ...p } } : null;
    },
    async signIn(email, pw) {
      const u = db.users.find(x => x.email === email.trim().toLowerCase() && x.pw === pw);
      if (!u) return fail('Неверная почта или пароль');
      db.session = u.id; save();
    },
    async signUp(email, pw, name, phone) {
      email = email.trim().toLowerCase();
      if (db.users.some(x => x.email === email)) return fail('Такая почта уже зарегистрирована');
      const uid = 'u' + id();
      db.users.push({ id: uid, email, pw });
      db.profiles.push({ id: uid, email, name, phone, role: 'student', created_at: now() });
      db.session = uid; save();
      return { needConfirm: false };
    },
    async resetPassword() { return fail('В демо-режиме восстановление пароля не работает'); },
    async signOut() { db.session = null; save(); },
    async myCourses() {
      return ok(isAdmin() ? db.courses : db.courses.filter(c => c.published &&
        db.enrollments.some(e => e.course_id === c.id && e.user_id === db.session)));
    },
    async toc(cid) {
      const uid = db.session;
      if (!isAdmin() && !db.enrollments.some(e => e.course_id === cid && e.user_id === uid)) return [];
      return ok(db.lessons.filter(l => l.course_id === cid && (isAdmin() || l.published))
        .sort((a, b) => a.position - b.position)
        .map(l => {
          const h = db.homework.filter(x => x.lesson_id === l.id && x.user_id === uid).sort((a, b) => b.id - a.id)[0];
          return {
            id: l.id, position: l.position, module: l.module, title: l.title, needs_homework: l.needs_homework,
            is_open: canSee(l.id), passed: db.progress.some(g => g.lesson_id === l.id && g.user_id === uid),
            hw_status: h?.status || null
          };
        }));
    },
    async lesson(lid) { return canSee(lid) ? ok(db.lessons.find(l => l.id === lid)) : null; },
    async comments(lid) {
      return canSee(lid) ? ok(db.comments.filter(c => c.lesson_id === lid).sort((a, b) => a.id - b.id)) : [];
    },
    async addComment(lid, text) {
      if (!canSee(lid)) return fail('Урок закрыт');
      const p = me();
      db.comments.push({ id: id(), lesson_id: lid, user_id: p.id, author_name: p.name, author_role: p.role, text, created_at: now() });
      save();
    },
    async deleteComment(cid) {
      db.comments = db.comments.filter(c => !(c.id === cid && (c.user_id === db.session || isAdmin()))); save();
    },
    async myHomework(lid) {
      return ok(db.homework.filter(h => h.lesson_id === lid && h.user_id === db.session).sort((a, b) => b.id - a.id));
    },
    async uploadShots(lid, blobs) {
      const out = [];
      for (const [i, b] of blobs.entries()) {
        const path = `${db.session}/${lid}/${Date.now()}-${i}.jpg`;
        db.files[path] = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
        out.push({ path, name: b.name || 'фото' });
      }
      return out;
    },
    async shotUrls(paths) { return Object.fromEntries(paths.map(p => [p, db.files[p]]).filter(x => x[1])); },
    async uploadMaterial(lid, file) {
      if (!isAdmin()) return fail('Только для админа');
      const path = `lesson-${lid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await idb.put(path, file);
      return { path, name: file.name, size: file.size };
    },
    async downloadMaterial(m) {
      if (!canSee(+String(m.path).match(/^lesson-(\d+)/)?.[1])) return fail('Урок закрыт');
      const blob = await idb.get(m.path);
      if (!blob) return fail('В демо файл есть только в том браузере, где его загрузили');
      const href = URL.createObjectURL(blob);
      saveAs(href, m.name); setTimeout(() => URL.revokeObjectURL(href), 5000);
    },
    async submitHomework(lid, text, files = []) {
      if (!lessonOpen(lid, db.session)) return fail('Урок закрыт');
      db.homework.push({ id: id(), lesson_id: lid, user_id: db.session, text, files, status: 'new', admin_reply: null, created_at: now() });
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch { db.homework.pop(); files.forEach(f => delete db.files[f.path]); return fail('В демо закончилось место: нажми «Сбросить демо»'); }
    },
    admin: {
      async homework(status) {
        return ok(db.homework.filter(h => !status || h.status === status).sort((a, b) => b.id - a.id)
          .map(h => ({ ...h, profiles: prof(h.user_id), lessons: db.lessons.find(l => l.id === h.lesson_id) || {} })));
      },
      async approve(hid, reply) {
        const h = db.homework.find(x => x.id === hid);
        Object.assign(h, { status: 'passed', admin_reply: reply || null, checked_at: now() });
        if (!db.progress.some(g => g.user_id === h.user_id && g.lesson_id === h.lesson_id))
          db.progress.push({ user_id: h.user_id, lesson_id: h.lesson_id, passed_at: now() });
        save();
      },
      async redo(hid, reply) {
        Object.assign(db.homework.find(x => x.id === hid), { status: 'redo', admin_reply: reply || null, checked_at: now() });
        save();
      },
      async students() {
        return ok({
          profiles: db.profiles, enrollments: db.enrollments, progress: db.progress,
          homework: db.homework.map(({ id, user_id, lesson_id, status, created_at }) => ({ id, user_id, lesson_id, status, created_at }))
        });
      },
      async saveStudent(p) { Object.assign(db.profiles.find(x => x.id === p.id), p); save(); },
      async setEnroll(uid, cid, on, until) {
        db.enrollments = db.enrollments.filter(e => !(e.user_id === uid && e.course_id === cid));
        if (on) db.enrollments.push({ user_id: uid, course_id: cid, access_until: until || null });
        save();
      },
      async passLesson(uid, lid, on) {
        db.progress = db.progress.filter(g => !(g.user_id === uid && g.lesson_id === lid));
        if (on) db.progress.push({ user_id: uid, lesson_id: lid, passed_at: now() });
        save();
      },
      async lessons(cid) { return ok(db.lessons.filter(l => l.course_id === cid).sort((a, b) => a.position - b.position)); },
      async saveLesson(l) {
        if (l.id) Object.assign(db.lessons.find(x => x.id === l.id), l);
        else db.lessons.push({ ...l, id: id() });
        save();
      },
      async deleteLesson(lid) { db.lessons = db.lessons.filter(l => l.id !== lid); save(); },
      async saveCourse(c) {
        if (c.id) Object.assign(db.courses.find(x => x.id === c.id), c);
        else db.courses.push({ ...c, id: id() });
        save();
      }
    }
  };
}

function supabaseApi() {
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  // Ссылка из письма «новый пароль» → экран нового пароля
  sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') location.hash = '#/new-password'; });
  const q =async p => { const { data, error } = await p; if (error) throw new Error(ruError(error.message)); return data; };
  let uid = null;
  return {
    demo: false,
    async session() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { uid = null; return null; }
      uid = session.user.id;
      const profile = await q(sb.from('profiles').select('*').eq('id', uid).maybeSingle());
      return { user: session.user, profile: profile || { id: uid, role: 'student', email: session.user.email } };
    },
    async signIn(email, password) { await q(sb.auth.signInWithPassword({ email: email.trim(), password })); },
    async signUp(email, password, name, phone) {
      const d = await q(sb.auth.signUp({ email: email.trim(), password, options: { data: { name, phone } } }));
      return { needConfirm: !d.session };
    },
    async resetPassword(email) {
      await q(sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname }));
    },
    async updatePassword(password) { await q(sb.auth.updateUser({ password })); },
    async signOut() { await sb.auth.signOut(); },
    myCourses: () => q(sb.from('courses').select('*').order('position')),
    toc: cid => q(sb.rpc('course_toc', { cid })),
    lesson: lid => q(sb.from('lessons').select('*').eq('id', lid).maybeSingle()),
    comments: lid => q(sb.from('comments').select('*').eq('lesson_id', lid).order('created_at')),
    addComment: (lid, text) => q(sb.from('comments').insert({ lesson_id: lid, user_id: uid, text })),
    deleteComment: id => q(sb.from('comments').delete().eq('id', id)),
    myHomework: lid => q(sb.from('homework').select('*').eq('lesson_id', lid).eq('user_id', uid).order('created_at', { ascending: false })),
    async uploadShots(lid, blobs) {
      const out = [];
      for (const [i, b] of blobs.entries()) {
        const path = `${uid}/${lid}/${Date.now()}-${i}.jpg`;
        await q(sb.storage.from('homework').upload(path, b, { contentType: 'image/jpeg' }));
        out.push({ path, name: b.name || 'фото' });
      }
      return out;
    },
    async shotUrls(paths) {
      if (!paths.length) return {};
      const d = await q(sb.storage.from('homework').createSignedUrls(paths, 3600));
      return Object.fromEntries(d.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
    },
    submitHomework: (lid, text, files = []) => q(sb.from('homework').insert({ lesson_id: lid, user_id: uid, text, files })),
    async uploadMaterial(lid, file) {
      const ext = (file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'bin').toLowerCase();
      const path = `lesson-${lid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      await q(sb.storage.from('materials').upload(path, file, { contentType: file.type || undefined }));
      return { path, name: file.name, size: file.size };
    },
    async downloadMaterial(m) {
      // Ссылка живёт 1 минуту и сразу отдаёт файл на скачивание под его настоящим именем
      const d = await q(sb.storage.from('materials').createSignedUrl(m.path, 60, { download: m.name || true }));
      saveAs(d.signedUrl);
    },
    admin: {
      homework(status) {
        let r = sb.from('homework').select('*, profiles(name, phone, telegram, email), lessons(title, course_id)')
          .order('created_at', { ascending: false }).limit(300);
        if (status) r = r.eq('status', status);
        return q(r);
      },
      approve: (hid, reply) => q(sb.rpc('approve_homework', { hid, reply: reply || '' })),
      redo: (hid, reply) => q(sb.rpc('return_homework', { hid, reply: reply || '' })),
      async students() {
        const [profiles, enrollments, progress, homework] = await Promise.all([
          q(sb.from('profiles').select('*').order('created_at', { ascending: false })),
          q(sb.from('enrollments').select('*')),
          q(sb.from('progress').select('*')),
          q(sb.from('homework').select('id, user_id, lesson_id, status, created_at'))
        ]);
        return { profiles, enrollments, progress, homework };
      },
      saveStudent: p => q(sb.from('profiles').update({
        name: p.name, phone: p.phone, telegram: p.telegram, package: p.package, paid: p.paid, note: p.note
      }).eq('id', p.id)),
      setEnroll: (u, cid, on, until) => on
        ? q(sb.from('enrollments').upsert({ user_id: u, course_id: cid, access_until: until || null }))
        : q(sb.from('enrollments').delete().eq('user_id', u).eq('course_id', cid)),
      passLesson: (u, lid, on) => on
        ? q(sb.from('progress').upsert({ user_id: u, lesson_id: lid }, { onConflict: 'user_id,lesson_id', ignoreDuplicates: true }))
        : q(sb.from('progress').delete().eq('user_id', u).eq('lesson_id', lid)),
      lessons: cid => q(sb.from('lessons').select('*').eq('course_id', cid).order('position')),
      saveLesson(l) {
        const { id, ...row } = l;
        return id ? q(sb.from('lessons').update(row).eq('id', id)) : q(sb.from('lessons').insert(row));
      },
      deleteLesson: id => q(sb.from('lessons').delete().eq('id', id)),
      saveCourse(c) {
        const { id, ...row } = c;
        return id ? q(sb.from('courses').update(row).eq('id', id)) : q(sb.from('courses').insert(row));
      }
    }
  };
}

function ruError(m) {
  if (/Invalid login/i.test(m)) return 'Неверная почта или пароль';
  if (/already registered/i.test(m)) return 'Такая почта уже зарегистрирована';
  if (/Password should be/i.test(m)) return 'Пароль слишком короткий: минимум 6 символов';
  if (/Email not confirmed/i.test(m)) return 'Подтверди почту: мы отправили письмо';
  if (/rate limit/i.test(m)) return 'Слишком много попыток. Подожди пару минут';
  if (/row-level security/i.test(m)) return 'Нет доступа';
  return m;
}

const api = DEMO ? demoApi() : supabaseApi();
let ME = null; // { user, profile }
const isAdmin = () => ME?.profile?.role === 'admin';
const app = $('#app');

// ============================================================
// Экраны
// ============================================================

function renderTop() {
  $('.brand-name').textContent = C.SCHOOL_NAME || 'Школа';
  const nav = $('.top-nav');
  if (!ME) { nav.innerHTML = ''; return; }
  nav.innerHTML = `
    ${isAdmin() ? '<a class="btn ghost sm" href="#/admin/hw">Админка</a>' : ''}
    <button class="btn ghost sm" id="logout">Выйти</button>`;
  $('#logout').onclick = async () => { await api.signOut(); ME = null; location.hash = '#/'; route(); };
}

// Демо-кнопки видит только владелец: один раз открыть /school/?owner, браузер запомнит
function isOwner() {
  try {
    if (/[?&]owner\b/.test(location.search)) localStorage.setItem('school_owner', '1');
    return localStorage.getItem('school_owner') === '1';
  } catch { return /[?&]owner\b/.test(location.search); }
}

function demoNote() {
  if (!api.demo || !isOwner()) return '';
  return `<div class="card demo-box small">
    <b>Демо-режим.</b> Видишь только ты. Всё хранится только в этом браузере.
    <div class="row" style="margin-top:10px">
      <button class="btn sm" data-demo="student@demo">Войти</button>
      <button class="btn ghost sm" data-demo="admin@demo">Войти как админ</button>
      <button class="link small" id="demo-reset">Сбросить демо</button>
    </div></div>`;
}
function bindDemo() {
  $$('[data-demo]').forEach(b => b.onclick = async () => {
    await api.signOut(); await api.signIn(b.dataset.demo, 'demo'); await boot();
    location.hash = b.dataset.demo.startsWith('admin') ? '#/admin/hw' : '#/';
  });
  const r = $('#demo-reset'); if (r) r.onclick = () => api.reset();
}

function renderAuth(mode = 'in') {
  app.className = '';
  app.innerHTML = `
    <div class="auth">
      ${demoNote()}
      <div class="card">
        <h1 style="text-align:center">Личный кабинет</h1>
        <p class="muted small" style="text-align:center;margin-top:-4px">Уроки, задания и связь со мной</p>
        <div class="tabs">
          <button data-m="in" class="${mode === 'in' ? 'on' : ''}">Вход</button>
          <button data-m="up" class="${mode === 'up' ? 'on' : ''}">Регистрация</button>
        </div>
        <form id="auth" class="stack">
          ${mode === 'up' ? `
            <div><label>Имя и фамилия</label><input name="name" required autocomplete="name"></div>
            <div><label>Телефон или WhatsApp</label><input name="phone" required autocomplete="tel" placeholder="+7 … или +82 …"></div>` : ''}
          <div><label>Почта</label><input name="email" type="email" required autocomplete="email"></div>
          <div><label>Пароль</label><input name="pw" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></div>
          <button class="btn" style="width:100%;justify-content:center">${mode === 'up' ? 'Зарегистрироваться' : 'Войти'}</button>
          ${mode === 'in' ? '<p style="text-align:center;margin:8px 0 0"><button type="button" class="link small" id="forgot">Забыли пароль?</button></p>' : ''}
          ${mode === 'up' ? '<p class="muted small" style="margin:0">После регистрации я открою доступ к курсу, как только подтвердится оплата.</p>' : ''}
        </form>
      </div>
    </div>`;
  bindDemo();
  $$('.tabs button').forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  const f = $('#auth');
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('.btn'); btn.disabled = true;
    try {
      if (mode === 'up') {
        const r = await api.signUp(d.email, d.pw, d.name.trim(), d.phone.trim());
        if (r.needConfirm) { toast('Мы отправили письмо. Подтверди почту и войди'); renderAuth('in'); return; }
      } else await api.signIn(d.email, d.pw);
      await boot();
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
  const fg = $('#forgot');
  if (fg) fg.onclick = async () => {
    const email = f.email.value;
    if (!email) return toast('Сначала впиши почту');
    try { await api.resetPassword(email); toast('Ссылка для нового пароля отправлена на почту'); }
    catch (err) { toast(err.message); }
  };
}

function renderNewPassword() {
  app.innerHTML = `<div class="auth"><div class="card"><h2>Новый пароль</h2>
    <form id="np" class="stack"><input name="pw" type="password" minlength="6" required placeholder="Минимум 6 символов">
    <button class="btn">Сохранить</button></form></div></div>`;
  $('#np').onsubmit = async e => {
    e.preventDefault();
    try { await api.updatePassword(e.target.pw.value); toast('Пароль сохранён'); location.hash = '#/'; }
    catch (err) { toast(err.message); }
  };
}

async function renderHome() {
  app.className = '';
  const courses = await api.myCourses();
  if (courses.length === 1) return renderCourse(courses[0].id, courses);
  app.innerHTML = `
    <h1>Привет, ${esc(ME.profile.name || '')}</h1>
    ${courses.length ? courses.map(c => `
      <a class="card" style="display:block;text-decoration:none" href="#/course/${c.id}">
        <h2>${esc(c.title)}</h2><div class="muted">${esc(c.description || '')}</div>
      </a>`).join('') : `
      <div class="card"><h2>Доступ скоро откроется</h2>
        <p class="muted">Регистрация прошла. Как только я подтвержу оплату, здесь появится курс.</p>
        <a class="btn" href="${esc(C.SUPPORT_TELEGRAM)}" target="_blank" rel="noopener">Написать в Telegram</a>
      </div>`}`;
}

async function renderCourse(cid, courses) {
  courses = courses || await api.myCourses();
  const c = courses.find(x => x.id === cid);
  if (!c) { app.innerHTML = '<div class="card">Курс не найден или доступ закрыт.</div>'; return; }
  const toc = await api.toc(cid);
  const need = toc.filter(l => l.needs_homework);
  const done = need.filter(l => l.passed).length;
  let mod = null;
  app.innerHTML = `
    ${courses.length > 1 ? '<a class="back" href="#/">← Все курсы</a>' : ''}
    <h1>${esc(c.title)}</h1>
    <p class="muted">${esc(c.description || '')}</p>
    ${need.length ? `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px">
      <b>Пройдено</b><span class="muted">${done} из ${need.length}</span></div>
      <div class="bar"><i style="width:${need.length ? done / need.length * 100 : 0}%"></i></div></div>` : ''}
    ${toc.map(l => {
      let head = '';
      if (l.module !== mod) { mod = l.module; head = `${l !== toc[0] ? '</ul>' : ''}<div class="module">${esc(mod || '')}</div><ul class="toc">`; }
      const status = l.passed ? '<span class="pill ok">Сдал ✓</span>' : hwPill(l.hw_status);
      const ico = l.passed ? '<span class="ico ok">✓</span>' : l.is_open ? '<span class="ico go">▶</span>' : '<span class="ico">🔒</span>';
      return head + (l.is_open
        ? `<li><a href="#/lesson/${l.id}">${ico}<span class="grow">${esc(l.title)}</span>${status}</a></li>`
        : `<li><div class="locked">${ico}<span class="grow">${esc(l.title)}<br><span class="small">Откроется после проверки домашки</span></span></div></li>`);
    }).join('')}</ul>
    ${!toc.length ? '<div class="card muted">Уроков пока нет.</div>' : ''}`;
}

let wmTimer = null;
function player(block) {
  const vid = ytId(block?.video);
  const mark = esc([ME.profile.name, ME.profile.phone || ME.user.email].filter(Boolean).join(' · '));
  return `<div class="player" id="player" oncontextmenu="return false">
    ${vid ? `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1&fs=0&iv_load_policy=3&playsinline=1"
      allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"
      title="${esc(block.title)}"></iframe>
      <div class="wm">${mark}</div>
      <button class="fs" id="fs" title="На весь экран">⛶</button>`
    : '<div class="empty">Видео к этому блоку скоро появится</div>'}
  </div>`;
}
function moveWatermark() {
  clearInterval(wmTimer);
  const move = () => {
    const p = $('#player'), w = p && $('.wm', p);
    if (!w) return clearInterval(wmTimer);
    w.style.left = 4 + Math.random() * Math.max(0, 92 - w.offsetWidth / p.offsetWidth * 100) + '%';
    w.style.top = 6 + Math.random() * Math.max(0, 88 - w.offsetHeight / p.offsetHeight * 100) + '%';
  };
  move(); wmTimer = setInterval(move, 7000);
  const fs = $('#fs');
  if (fs) fs.onclick = () => {
    const p = $('#player');
    if (document.fullscreenElement) document.exitFullscreen();
    else (p.requestFullscreen || p.webkitRequestFullscreen)?.call(p);
  };
}

async function renderLesson(lid) {
  app.className = '';
  const l = await api.lesson(lid);
  if (!l) {
    app.innerHTML = `<a class="back" href="#/">← Оглавление</a>
      <div class="card"><h2>🔒 Урок пока закрыт</h2><p class="muted">Он откроется, когда я приму домашку к прошлому уроку.</p></div>`;
    return;
  }
  const [toc, hw, comments] = await Promise.all([
    api.toc(l.course_id),
    isAdmin() ? [] : api.myHomework(lid),
    api.comments(lid)
  ]);
  const idx = toc.findIndex(x => x.id === lid);
  const next = toc[idx + 1];
  const passed = toc[idx]?.passed || !l.needs_homework;
  const last = hw[0];
  const urls = await api.shotUrls(hw.flatMap(h => (h.files || []).map(f => f.path)));
  const blocks = (l.blocks || []).length ? l.blocks : [{ title: '', video: '' }];
  let cur = 0;

  app.innerHTML = `
    <a class="back" href="#/course/${l.course_id}">← Оглавление</a>
    <div class="muted small">${esc(l.module || '')}</div>
    <h1>${esc(l.title)}</h1>
    ${isAdmin() ? `<p><a class="btn ghost sm" href="#/admin/lessons/${l.course_id}/${l.id}">✎ Редактировать урок</a></p>` : ''}
    ${blocks.length > 1 ? `<div class="chips">${blocks.map((b, i) =>
      `<button data-b="${i}" class="${i ? '' : 'on'}">Блок ${i + 1}${b.title ? ' · ' + esc(b.title) : ''}</button>`).join('')}</div>` : ''}
    <div id="pl">${player(blocks[0])}</div>
    ${l.needs_homework && !isAdmin() && !toc[idx]?.passed ? `<div style="margin-top:14px">
      <button class="btn" id="go-hw" style="width:100%;justify-content:center;padding:14px">📝 Сдать ДЗ</button></div>` : ''}
    ${l.body ? `<div class="card text" style="margin-top:16px">${linkify(l.body)}</div>` : '<div style="height:16px"></div>'}
    ${(l.materials || []).length ? `<div class="card files"><h3>Материалы</h3>
      ${l.materials.map((m, i) => {
        const [lab, col] = EXT[fileExt(m)] || ['ФАЙЛ', '#6e6e73'];
        const ready = m.path || m.url;
        return `<button type="button" class="file" data-mat="${i}" ${ready ? '' : 'disabled'}>
          <span class="ext" style="background:${col}">${lab}</span>
          <span class="grow"><b>${esc(m.title || m.name)}</b>${m.size ? `<span class="muted small">${fmtSize(m.size)}</span>` : ''}</span>
          <span class="dl">${ready ? '⬇<i> Скачать</i>' : '<i>скоро</i>'}</span></button>`;
      }).join('')}</div>` : ''}
    ${l.needs_homework ? `<div class="card" id="hw">
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Домашнее задание</h2>${toc[idx]?.passed ? hwPill('passed') : hwPill(last?.status)}</div>
      ${l.homework ? `<div class="task text" style="margin:14px 0">${linkify(l.homework)}</div>` : ''}
      ${isAdmin() ? '<p class="muted small">Ответы учеников — в админке, вкладка «Домашки».</p>' : `
        ${hw.map(h => `<div class="hw-item">
          <div class="row" style="justify-content:space-between"><span class="muted small">${fmt(h.created_at)}</span>${hwPill(h.status)}</div>
          ${h.text ? `<div class="text" style="margin-top:6px">${linkify(h.text)}</div>` : ''}
          ${shots(h.files, urls)}
          ${h.admin_reply ? `<div class="reply"><b>Константин:</b> <span class="text">${linkify(h.admin_reply)}</span></div>` : ''}
        </div>`).join('')}
        ${toc[idx]?.passed ? '' : `<form id="hw-form" class="stack" style="margin-top:14px">
          <label>${last?.status === 'redo' ? 'Исправленный ответ' : last?.status === 'new' ? 'Дополнить ответ' : 'Твой ответ'}</label>
          <textarea name="text" placeholder="Напиши ответ. Аудио или видео — вставь сюда ссылку"></textarea>
          <div class="shots" id="hw-prev"></div>
          <div class="row">
            <label class="btn ghost sm" for="hw-file" style="margin:0;color:var(--text)">📷 Прикрепить фото или скриншот</label>
            <input id="hw-file" type="file" accept="image/*" multiple hidden>
            <span class="muted small">до ${MAX_SHOTS} шт.: тетрадь, переписка, профиль</span>
          </div>
          <button class="btn">📝 Сдать ДЗ</button>
        </form>`}`}
    </div>` : `<div class="card muted">В этом уроке задания нет. Переходи к следующему уроку.</div>`}
    ${next ? `<div class="card row" style="justify-content:space-between">
      <div><div class="muted small">Следующий урок</div><b>${esc(next.title)}</b></div>
      ${next.is_open ? `<a class="btn" href="#/lesson/${next.id}">Перейти →</a>`
        : `<span class="pill">🔒 ${passed ? 'скоро' : 'после проверки домашки'}</span>`}
    </div>` : ''}
    <div class="card"><h2>Комментарии</h2>
      <div id="comments">${comments.length ? comments.map(c => `<div class="comment">
        <div class="row"><span class="who">${esc(c.author_name || 'Ученик')}</span>${c.author_role === 'admin' ? '<span class="badge-admin">автор курса</span>' : ''}
          <span class="muted small grow">${fmt(c.created_at)}</span>
          ${c.user_id === ME.user.id || isAdmin() ? `<button class="btn danger sm" data-del="${c.id}">удалить</button>` : ''}</div>
        <div class="text">${linkify(c.text)}</div></div>`).join('') : '<p class="muted">Пока нет комментариев. Задай вопрос по уроку.</p>'}</div>
      <form id="c-form" class="stack" style="margin-top:12px">
        <textarea name="text" required placeholder="Вопрос или мысль по уроку" style="min-height:80px"></textarea>
        <button class="btn ghost">Отправить</button>
      </form>
    </div>`;

  moveWatermark();
  $$('[data-mat]').forEach(b => b.onclick = async () => {
    const m = l.materials[+b.dataset.mat];
    b.disabled = true;
    try { if (m.path) await api.downloadMaterial(m); else saveAs(dlUrl(m.url)); }
    catch (err) { toast(err.message); }
    setTimeout(() => { b.disabled = false; }, 1200);
  });
  const goHw = $('#go-hw');
  if (goHw) goHw.onclick = () => {
    $('#hw').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ta = $('#hw-form textarea'); if (ta) setTimeout(() => ta.focus({ preventScroll: true }), 500);
  };
  $$('.chips button').forEach(b => b.onclick = () => {
    cur = +b.dataset.b;
    $$('.chips button').forEach(x => x.classList.toggle('on', x === b));
    $('#pl').innerHTML = player(blocks[cur]); moveWatermark();
  });
  const hf = $('#hw-form');
  if (hf) {
    const picked = [];
    const drawPrev = () => {
      $('#hw-prev').innerHTML = picked.map((f, i) => `<span class="shot-new"><img src="${f.url}" alt="">
        <button type="button" data-rm-shot="${i}" title="Убрать">✕</button></span>`).join('');
      $$('[data-rm-shot]', hf).forEach(b => b.onclick = () => {
        URL.revokeObjectURL(picked[+b.dataset.rmShot].url); picked.splice(+b.dataset.rmShot, 1); drawPrev();
      });
    };
    const add = list => {
      const imgs = [...list].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
      if (list.length && !imgs.length) return toast('Можно прикрепить только фото и скриншоты');
      const room = MAX_SHOTS - picked.length;
      if (imgs.length > room) toast(`Не больше ${MAX_SHOTS} фото в одной сдаче`);
      imgs.slice(0, Math.max(0, room)).forEach(file => picked.push({ file, url: URL.createObjectURL(file) }));
      drawPrev();
    };
    $('#hw-file').onchange = e => { add(e.target.files); e.target.value = ''; };
    hf.text.addEventListener('paste', e => {
      const imgs = [...(e.clipboardData?.files || [])];
      if (imgs.length) { e.preventDefault(); add(imgs); }
    });
    hf.onsubmit = async e => {
      e.preventDefault();
      const text = hf.text.value.trim();
      if (!text && !picked.length) return toast('Напиши ответ или прикрепи фото');
      const btn = hf.querySelector('button.btn:not([type])'); btn.disabled = true;
      try {
        if (picked.length) btn.textContent = 'Загружаю фото…';
        const blobs = await Promise.all(picked.map(async p => Object.assign(await shrink(p.file), { name: p.file.name })));
        const files = await api.uploadShots(lid, blobs);
        await api.submitHomework(lid, text, files);
        toast('Отправлено. Я проверю и открою следующий урок'); renderLesson(lid);
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '📝 Сдать ДЗ'; }
    };
  }
  $('#c-form').onsubmit = async e => {
    e.preventDefault();
    try { await api.addComment(lid, e.target.text.value.trim()); renderLesson(lid); }
    catch (err) { toast(err.message); }
  };
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Удалить комментарий?')) return;
    await api.deleteComment(+b.dataset.del); renderLesson(lid);
  });
}

// ---------- Админка ----------

async function renderAdmin(tab = 'hw', a, b) {
  if (!isAdmin()) { location.hash = '#/'; return; }
  app.className = 'wide';
  const fresh = (await api.admin.homework('new')).length;
  app.innerHTML = `
    <h1>Админка</h1>
    <div class="admin-tabs">
      <a href="#/admin/hw" class="${tab === 'hw' ? 'on' : ''}">Домашки${fresh ? `<span class="count">${fresh}</span>` : ''}</a>
      <a href="#/admin/students" class="${tab === 'students' ? 'on' : ''}">Ученики</a>
      <a href="#/admin/lessons" class="${tab === 'lessons' ? 'on' : ''}">Уроки</a>
    </div>
    <div id="tab"></div>`;
  const box = $('#tab');
  if (tab === 'hw') return adminHomework(box, a || 'new');
  if (tab === 'students') return adminStudents(box);
  if (tab === 'lessons') return adminLessons(box, a ? +a : null, b ? +b : null);
}

async function adminHomework(box, filter) {
  const list = await api.admin.homework(filter === 'all' ? null : filter);
  const urls = await api.shotUrls(list.flatMap(h => (h.files || []).map(f => f.path)));
  const F = { new: 'Новые', redo: 'На доработке', passed: 'Принятые', all: 'Все' };
  box.innerHTML = `
    <div class="chips">${Object.entries(F).map(([k, v]) =>
      `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${v}</button>`).join('')}</div>
    ${list.length ? list.map(h => `<div class="card" data-h="${h.id}">
      <div class="row" style="justify-content:space-between">
        <div><b>${esc(h.profiles?.name || 'Без имени')}</b>
          <span class="muted small">${esc([h.profiles?.phone, h.profiles?.telegram].filter(Boolean).join(' · '))}</span></div>
        ${hwPill(h.status)}
      </div>
      <div class="muted small" style="margin:4px 0 10px">${esc(h.lessons?.title || '')} · ${fmt(h.created_at)}</div>
      ${h.text ? `<div class="text">${linkify(h.text)}</div>` : ''}
      ${shots(h.files, urls)}
      ${h.admin_reply ? `<div class="reply"><b>Мой ответ:</b> <span class="text">${linkify(h.admin_reply)}</span></div>` : ''}
      ${h.status === 'new' ? `<div class="stack" style="margin-top:12px">
        <textarea class="rep" placeholder="Комментарий ученику (можно пусто)" style="min-height:70px"></textarea>
        <div class="row">
          <button class="btn ok" data-ok="${h.id}">✅ Сдал — открыть следующий урок</button>
          <button class="btn warn" data-redo="${h.id}">🔁 На доработку</button>
          <a class="btn ghost sm" href="#/lesson/${h.lesson_id}">Открыть урок</a>
        </div></div>` : ''}
    </div>`).join('') : `<div class="card muted">${filter === 'new' ? 'Новых домашек нет 👌' : 'Пусто'}</div>`}`;
  $$('[data-f]').forEach(x => x.onclick = () => adminHomework(box, x.dataset.f));
  const act = async (fn, hid, msg) => {
    const rep = $(`[data-h="${hid}"] .rep`).value.trim();
    try { await fn(hid, rep); toast(msg); renderAdmin('hw', filter); } catch (err) { toast(err.message); }
  };
  $$('[data-ok]').forEach(x => x.onclick = () => act(api.admin.approve, +x.dataset.ok, 'Принято. Следующий урок открыт'));
  $$('[data-redo]').forEach(x => x.onclick = () => act(api.admin.redo, +x.dataset.redo, 'Отправлено на доработку'));
}

async function adminStudents(box) {
  const [data, courses] = await Promise.all([api.admin.students(), api.myCourses()]);
  const lessonsBy = {};
  await Promise.all(courses.map(async c => { lessonsBy[c.id] = await api.admin.lessons(c.id); }));
  const students = data.profiles.filter(p => p.role !== 'admin');
  const draw = (term = '') => {
    const t = term.toLowerCase();
    const shown = students.filter(p => !t || [p.name, p.email, p.phone, p.telegram, p.note].join(' ').toLowerCase().includes(t));
    $('#st-list').innerHTML = shown.length ? shown.map(p => {
      const en = data.enrollments.filter(e => e.user_id === p.id);
      const courseInfo = en.map(e => {
        const ls = (lessonsBy[e.course_id] || []).filter(l => l.needs_homework);
        const done = ls.filter(l => data.progress.some(g => g.user_id === p.id && g.lesson_id === l.id)).length;
        const c = courses.find(x => x.id === e.course_id);
        return `<div class="small">${esc(c?.title || '')}: <b>${done} из ${ls.length}</b>${e.access_until ? ` · до ${esc(e.access_until)}` : ''}</div>`;
      }).join('');
      const waiting = data.homework.filter(h => h.user_id === p.id && h.status === 'new').length;
      return `<div class="card student" data-s="${p.id}">
        <div class="row" style="justify-content:space-between">
          <div><b>${esc(p.name || 'Без имени')}</b> ${p.package ? `<span class="pill">${esc(p.package)}</span>` : ''}</div>
          ${waiting ? `<span class="pill warn">ждёт проверки: ${waiting}</span>` : en.length ? '' : '<span class="pill bad">нет доступа</span>'}
        </div>
        <div class="muted small">${esc([p.phone, p.telegram, p.email].filter(Boolean).join(' · '))}</div>
        <div style="margin-top:6px">${courseInfo}</div>
        ${p.note ? `<div class="muted small" style="margin-top:4px">📝 ${esc(p.note)}</div>` : ''}
      </div>`;
    }).join('') : '<div class="card muted">Учеников пока нет. Они появятся здесь после регистрации.</div>';
    $$('[data-s]').forEach(x => x.onclick = () => studentDialog(students.find(p => p.id === x.dataset.s), data, courses, lessonsBy));
  };
  box.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <input id="st-search" class="grow" placeholder="Поиск: имя, телефон, почта">
      <span class="muted small">Всего: ${students.length}</span>
    </div>
    <div id="st-list"></div>`;
  $('#st-search').oninput = e => draw(e.target.value);
  draw();
}

function studentDialog(p, data, courses, lessonsBy) {
  const d = document.createElement('dialog');
  const en = cid => data.enrollments.find(e => e.user_id === p.id && e.course_id === cid);
  const passed = lid => data.progress.some(g => g.user_id === p.id && g.lesson_id === lid);
  d.innerHTML = `<form method="dialog" class="inner stack" id="sf">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(p.name || 'Ученик')}</h2>
      <button class="btn ghost sm" value="cancel">Закрыть</button></div>
    <div class="muted small">${esc(p.email || '')} · с ${fmt(p.created_at)}</div>
    <div class="grid2">
      <div><label>Имя</label><input name="name" value="${esc(p.name)}"></div>
      <div><label>Телефон</label><input name="phone" value="${esc(p.phone)}"></div>
      <div><label>Telegram</label><input name="telegram" value="${esc(p.telegram)}"></div>
      <div><label>Пакет</label><select name="package">
        ${['', 'базовый', 'стандарт', 'премиум'].map(v => `<option ${p.package === v ? 'selected' : ''} value="${v}">${v || '—'}</option>`).join('')}
      </select></div>
    </div>
    <div><label>Оплата</label><input name="paid" value="${esc(p.paid)}" placeholder="Например: 300 000 ₸, 20.10, Kaspi"></div>
    <div><label>Заметка</label><textarea name="note" style="min-height:70px">${esc(p.note)}</textarea></div>
    <button class="btn" value="save" id="save-st">Сохранить карточку</button>
    ${courses.map(c => {
      const e = en(c.id);
      return `<div class="card" style="margin:0">
        <div class="row" style="justify-content:space-between">
          <label class="check"><input type="checkbox" data-en="${c.id}" ${e ? 'checked' : ''}> Доступ к курсу «${esc(c.title)}»</label>
        </div>
        <div class="row" style="margin-top:8px"><label style="margin:0">Доступ до</label>
          <input type="date" data-until="${c.id}" value="${esc(e?.access_until || '')}" style="width:auto"></div>
        <div style="margin-top:10px">${(lessonsBy[c.id] || []).filter(l => l.needs_homework).map(l =>
          `<label class="check" style="margin:6px 0"><input type="checkbox" data-pass="${l.id}" ${passed(l.id) ? 'checked' : ''}> ${esc(l.title)}</label>`).join('')}
          <p class="muted small" style="margin:6px 0 0">Галочка = урок сдан, следующий открыт. Можно ставить вручную.</p>
        </div></div>`;
    }).join('')}
  </form>`;
  document.body.append(d); d.showModal();
  d.addEventListener('close', () => { d.remove(); if (d.dirty) renderAdmin('students'); });
  $('#save-st', d).onclick = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData($('#sf', d)));
    try { await api.admin.saveStudent({ id: p.id, ...f }); Object.assign(p, f); d.dirty = true; toast('Сохранено'); }
    catch (err) { toast(err.message); }
  };
  const setEn = async cid => {
    const on = $(`[data-en="${cid}"]`, d).checked, until = $(`[data-until="${cid}"]`, d).value;
    try { await api.admin.setEnroll(p.id, cid, on, until); d.dirty = true; toast(on ? 'Доступ открыт' : 'Доступ закрыт'); }
    catch (err) { toast(err.message); }
  };
  $$('[data-en]', d).forEach(x => x.onchange = () => setEn(+x.dataset.en));
  $$('[data-until]', d).forEach(x => x.onchange = () => { if ($(`[data-en="${x.dataset.until}"]`, d).checked) setEn(+x.dataset.until); });
  $$('[data-pass]', d).forEach(x => x.onchange = async () => {
    try { await api.admin.passLesson(p.id, +x.dataset.pass, x.checked); d.dirty = true; toast(x.checked ? 'Отмечено: сдал' : 'Отметка снята'); }
    catch (err) { toast(err.message); }
  });
}

async function adminLessons(box, cid, editId) {
  const courses = await api.myCourses();
  cid = cid || courses[0]?.id;
  const lessons = cid ? await api.admin.lessons(cid) : [];
  if (editId !== null && editId !== undefined) {
    const l = editId ? lessons.find(x => x.id === editId) : {
      course_id: cid, position: (lessons.at(-1)?.position ?? 0) + 1, module: lessons.at(-1)?.module || '',
      title: '', blocks: [{ title: '', video: '' }], body: '', homework: '', materials: [], needs_homework: true, published: true
    };
    if (!l) { box.innerHTML = '<div class="card">Урок не найден</div>'; return; }
    return lessonForm(box, l);
  }
  box.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <select id="course-sel" class="grow">${courses.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <button class="btn ghost sm" id="new-course">+ Курс</button>
    </div>
    <div class="card">
      ${lessons.map(l => `<div class="lesson-row">
        <span class="muted small" style="width:24px">${l.position}</span>
        <div class="grow"><b>${esc(l.title)}</b><div class="muted small">${esc(l.module || '')} ·
          ${(l.blocks || []).filter(b => ytId(b.video)).length}/${(l.blocks || []).length} видео
          ${l.needs_homework ? '' : ' · без домашки'}${l.published ? '' : ' · <b>скрыт</b>'}</div></div>
        <a class="btn ghost sm" href="#/admin/lessons/${cid}/${l.id}">Изменить</a>
      </div>`).join('') || '<p class="muted">Уроков нет</p>'}
    </div>
    ${cid ? `<a class="btn" href="#/admin/lessons/${cid}/0">+ Добавить урок</a>` : ''}`;
  const sel = $('#course-sel');
  if (sel) sel.onchange = () => { location.hash = `#/admin/lessons/${sel.value}`; };
  $('#new-course').onclick = async () => {
    const title = prompt('Название нового курса');
    if (!title) return;
    await api.admin.saveCourse({ title, description: '', position: courses.length + 1, published: true });
    renderAdmin('lessons');
  };
}

function lessonForm(box, l) {
  const rowB = (b = {}) => `<div class="repeat" data-row="b">
    <input placeholder="Название блока" data-k="title" value="${esc(b.title)}">
    <input placeholder="Ссылка на YouTube (видео «доступ по ссылке»)" data-k="video" value="${esc(b.video)}">
    <button type="button" class="btn danger sm" data-rm>✕</button></div>`;
  const rowM = (m = {}) => `<div class="repeat mat" data-row="m">
    <input placeholder="Название для ученика" data-k="title" value="${esc(m.title)}">
    <div class="mat-file">
      <input type="hidden" data-k="path" value="${esc(m.path)}"><input type="hidden" data-k="name" value="${esc(m.name)}">
      <input type="hidden" data-k="size" value="${esc(m.size)}">
      <span class="mat-name small">${m.path ? `📎 ${esc(m.name)} · ${fmtSize(m.size)}` : ''}</span>
      <input placeholder="или ссылка (Google Диск)" data-k="url" value="${esc(m.url)}" ${m.path ? 'hidden' : ''}>
      <label class="btn ghost sm" style="margin:0;color:var(--text);white-space:nowrap">${m.path ? 'Заменить' : '⬆ Загрузить файл'}
        <input type="file" hidden data-up></label>
    </div>
    <button type="button" class="btn danger sm" data-rm>✕</button></div>`;
  box.innerHTML = `
    <a class="back" href="#/admin/lessons/${l.course_id}">← Все уроки</a>
    <form id="lf" class="card stack">
      <h2>${l.id ? 'Редактировать урок' : 'Новый урок'}</h2>
      <div class="grid3">
        <div><label>Порядок</label><input name="position" type="number" value="${l.position}"></div>
        <div style="grid-column:span 2"><label>Модуль</label><input name="module" value="${esc(l.module)}"></div>
      </div>
      <div><label>Название урока</label><input name="title" required value="${esc(l.title)}"></div>
      <div><label>Видео-блоки</label><div id="blocks">${(l.blocks || []).map(rowB).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-b">+ Блок</button></div>
      <div><label>Текст под видео</label><textarea name="body">${esc(l.body)}</textarea></div>
      <div><label>Материалы для скачивания</label><div id="mats">${(l.materials || []).map(rowM).join('')}</div>
        <button type="button" class="btn ghost sm" id="add-m">+ Файл</button></div>
      <label class="check"><input type="checkbox" name="needs_homework" ${l.needs_homework ? 'checked' : ''}> Есть домашка (следующий урок откроется только после «Сдал»)</label>
      <div><label>Задание</label><textarea name="homework">${esc(l.homework)}</textarea></div>
      <label class="check"><input type="checkbox" name="published" ${l.published ? 'checked' : ''}> Урок виден ученикам</label>
      <div class="row">
        <button class="btn">Сохранить</button>
        ${l.id ? `<a class="btn ghost" href="#/lesson/${l.id}">Посмотреть</a><button type="button" class="btn danger" id="del-l">Удалить урок</button>` : ''}
      </div>
    </form>`;
  const bindRm = () => {
    $$('[data-rm]', box).forEach(x => x.onclick = () => x.closest('.repeat').remove());
    $$('[data-up]', box).forEach(x => x.onchange = async () => {
      const file = x.files[0], row = x.closest('.repeat'); x.value = '';
      if (!file) return;
      if (!l.id) return toast('Сначала сохрани урок, потом загружай файлы');
      const set = (k, v) => { $(`[data-k="${k}"]`, row).value = v; };
      const nameEl = $('.mat-name', row);
      nameEl.textContent = 'Загружаю…';
      try {
        const up = await api.uploadMaterial(l.id, file);
        set('path', up.path); set('name', up.name); set('size', up.size); set('url', '');
        $('[data-k="url"]', row).hidden = true;
        if (!$('[data-k="title"]', row).value.trim()) set('title', file.name.replace(/\.[^.]+$/, '').replace(/^\d+[а-яa-z]?\.\s*/i, ''));
        nameEl.textContent = `📎 ${up.name} · ${fmtSize(up.size)}`;
        toast('Файл загружен. Не забудь «Сохранить»');
      } catch (err) { nameEl.textContent = ''; toast(err.message); }
    });
  };
  $('#add-b').onclick = () => { $('#blocks').insertAdjacentHTML('beforeend', rowB()); bindRm(); };
  $('#add-m').onclick = () => { $('#mats').insertAdjacentHTML('beforeend', rowM()); bindRm(); };
  bindRm();
  const rows = sel => $$(sel, box).map(r => Object.fromEntries($$('[data-k]', r).map(i => [i.dataset.k, i.value.trim()])));
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const blocks = rows('[data-row="b"]').filter(b => b.title || b.video);
    const bad = blocks.find(b => b.video && !ytId(b.video));
    if (bad) return toast(`Не понял ссылку в блоке «${bad.title || bad.video}»`);
    const row = {
      ...(l.id ? { id: l.id } : {}), course_id: l.course_id,
      position: +f.position.value || 0, module: f.module.value.trim(), title: f.title.value.trim(),
      blocks, body: f.body.value,
      materials: rows('[data-row="m"]').filter(m => m.title || m.url || m.path).map(m => {
        const o = { title: m.title || m.name };
        const old = (l.materials || []).find(x => x.title === o.title && x.ext);
        if (old && !m.path) o.ext = old.ext;
        if (m.path) Object.assign(o, { path: m.path, name: m.name, size: +m.size || 0 });
        else if (m.url) o.url = m.url;
        return o;
      }),
      needs_homework: f.needs_homework.checked, homework: f.homework.value, published: f.published.checked
    };
    try { await api.admin.saveLesson(row); toast('Урок сохранён'); location.hash = `#/admin/lessons/${l.course_id}`; }
    catch (err) { toast(err.message); }
  };
  const del = $('#del-l');
  if (del) del.onclick = async () => {
    if (!confirm('Удалить урок вместе с домашками и комментариями к нему?')) return;
    await api.admin.deleteLesson(l.id); toast('Урок удалён'); location.hash = `#/admin/lessons/${l.course_id}`;
  };
}

// ============================================================
// Маршруты
// ============================================================

async function route() {
  clearInterval(wmTimer);
  const [, page, a, b, c] = (location.hash || '#/').split('/');
  if (page === 'new-password') return renderNewPassword();
  if (!ME) return renderAuth();
  renderTop();
  try {
    if (page === 'lesson') await renderLesson(+a);
    else if (page === 'course') await renderCourse(+a);
    else if (page === 'admin') await renderAdmin(a, b, c);
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="card"><h2>Что-то пошло не так</h2><p class="muted">${esc(err.message)}</p></div>`;
  }
}

async function boot() {
  try { ME = await api.session(); } catch (err) { console.error(err); ME = null; }
  renderTop();
  await route();
}

window.addEventListener('hashchange', route);
document.addEventListener('contextmenu', e => { if (e.target.closest('.player')) e.preventDefault(); });
// Фото домашки — крупно поверх страницы
document.addEventListener('click', e => {
  const a = e.target.closest('.shots a'); if (!a) return;
  e.preventDefault();
  const d = document.createElement('dialog'); d.className = 'shot-view';
  d.innerHTML = `<img src="${esc(a.href)}" alt=""><button class="btn ghost sm">Закрыть</button>`;
  d.onclick = () => d.close(); d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
});
boot();
})();
