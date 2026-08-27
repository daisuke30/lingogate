// UI internationalisation (LINGO-014). The third language axis (design §1):
// the app's UI language, independent of the course (card back) and the front
// (prompt) language. Default is Japanese — unchanged for the existing RU user.
//
// The catalog keeps all three translations for a key together so they can't
// drift apart. `t(key, params?)` interpolates {name} placeholders. Missing
// key / missing language both fall back to Japanese, then to the raw key, so a
// half-translated build degrades gracefully instead of blanking the UI.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getAppLang, setAppLang } from "../state/settings";
import type { Lang } from "../content/courses";

export type { Lang };
export const UI_LANGS: Lang[] = ["ja", "en", "ru"];

/** Language display name in its OWN script (constant across UI languages) — for
 * language pickers and card kickers. */
export const NATIVE_LANG_NAME: Record<Lang, string> = {
  ja: "日本語",
  en: "English",
  ru: "Русский",
};

type Entry = Record<Lang, string>;

// Note on placeholders: {n},{m},{pct},{app},{lang},{front},{back},{v},{cards},
// {k},{u},{j},{t},{min},{count},{covered},{total} — see call sites.
const M: Record<string, Entry> = {
  // -- common ---------------------------------------------------------------
  "common.home": { ja: "ホーム", en: "Home", ru: "Главная" },
  "common.backHome": { ja: "‹ ホーム", en: "‹ Home", ru: "‹ Главная" },
  "common.loading": { ja: "読み込み中…", en: "Loading…", ru: "Загрузка…" },
  "common.checking": { ja: "確認中…", en: "Checking…", ru: "Проверка…" },
  "common.on": { ja: "オン", en: "On", ru: "Вкл" },
  "common.off": { ja: "オフ", en: "Off", ru: "Выкл" },
  "badge.default": { ja: "既定", en: "Default", ru: "По умолч." },
  "badge.comingSoon": { ja: "準備中", en: "Coming soon", ru: "Скоро" },
  "badge.inUse": { ja: "使用中", en: "In use", ru: "Активно" },

  // -- localized language names (used inside sentences) ----------------------
  "lang.name.ja": { ja: "日本語", en: "Japanese", ru: "японский" },
  "lang.name.en": { ja: "英語", en: "English", ru: "английский" },
  "lang.name.ru": { ja: "ロシア語", en: "Russian", ru: "русский" },

  // -- home -----------------------------------------------------------------
  "home.guide": { ja: "ガイド", en: "Guide", ru: "Гид" },
  "home.settings": { ja: "設定", en: "Settings", ru: "Настройки" },
  "home.stat.gates": { ja: "今日のゲート", en: "Gates today", ru: "Проверок сегодня" },
  "home.stat.unlocks": { ja: "解除", en: "Unlocks", ru: "Разблокировок" },
  "home.stat.knownRate": { ja: "既知率", en: "Known rate", ru: "Знакомых" },
  "home.mastery.title": {
    ja: "会話頻出3000語マスター",
    en: "Top 3000 conversation words",
    ru: "3000 частотных слов",
  },
  "home.mastery.unit": { ja: "語 マスター", en: "mastered", ru: "освоено" },
  "home.mastery.coverage": {
    ja: "推定会話カバー率",
    en: "Est. conversation coverage",
    ru: "Оценка охвата речи",
  },
  "home.mastery.progress": { ja: "3000語 進捗", en: "Progress to 3000", ru: "Прогресс до 3000" },
  "home.calib.title": {
    ja: "既知語の仕分け（キャリブレーション）",
    en: "Sort your known words (calibration)",
    ru: "Разбор знакомых слов (калибровка)",
  },
  "home.calib.continue": { ja: "続きから仕分ける", en: "Continue sorting", ru: "Продолжить разбор" },
  "home.calib.start": { ja: "1000語を仕分ける", en: "Sort 1000 words", ru: "Разобрать 1000 слов" },
  "home.calib.desc": {
    ja: "知っている語を右、知らない語を左へ。カードの並びはあなたの既知語マップで最適化されます。",
    en: "Swipe right for words you know, left for ones you don't. Your card order is optimised from the resulting map.",
    ru: "Знакомые слова — вправо, незнакомые — влево. Порядок карточек подстраивается под вашу карту знаний.",
  },
  "home.band.title": { ja: "band1 の進み具合", en: "band1 progress", ru: "Прогресс band1" },
  "home.band.coverage": { ja: "語彙カバー", en: "Vocabulary covered", ru: "Охват слов" },
  "home.band.retention": { ja: "定着率", en: "Retention", ru: "Удержание" },
  "home.band.noData": { ja: "まだデータなし", en: "No data yet", ru: "Пока нет данных" },
  "home.band.retentionValue": {
    ja: "{pct}%（{cards}枚）",
    en: "{pct}% ({cards} cards)",
    ru: "{pct}% ({cards} карт.)",
  },
  "home.band.dueNow": {
    ja: "復習の期限が来たカード: {n} 枚",
    en: "Cards due for review: {n}",
    ru: "Карточек к повторению: {n}",
  },
  "home.solve": { ja: "{lang}を解く", en: "Practise {lang}", ru: "Заниматься: {lang}" },
  "home.setupAutomation": {
    ja: "オートメーションを設定する",
    en: "Set up automation",
    ru: "Настроить автоматизацию",
  },

  // -- mastery level ladder --------------------------------------------------
  "mastery.level.beginner": { ja: "完全初心者", en: "Absolute beginner", ru: "Начинающий" },
  "mastery.level.words": { ja: "{n}マスター", en: "{n} mastered", ru: "{n} освоено" },

  // -- settings -------------------------------------------------------------
  "settings.title": { ja: "設定", en: "Settings", ru: "Настройки" },
  "settings.section.appLang": { ja: "アプリの言語", en: "App language", ru: "Язык приложения" },
  "settings.appLang.sub": {
    ja: "表示言語を切り替えます（コンテンツとは無関係）",
    en: "Switch the interface language (independent of content).",
    ru: "Язык интерфейса (не зависит от контента).",
  },
  "settings.section.course": {
    ja: "学習コース（裏面の言語）",
    en: "Course (back-of-card language)",
    ru: "Курс (язык оборота карточки)",
  },
  "settings.course.sub": {
    ja: "学ぶ言語。進捗はコースごとに独立します。",
    en: "The language you're learning. Progress is separate per course.",
    ru: "Изучаемый язык. Прогресс независим для каждого курса.",
  },
  "settings.section.frontLang": {
    ja: "表面の言語（ヒント・訳）",
    en: "Prompt language (hints & glosses)",
    ru: "Язык подсказок (перевод)",
  },
  "settings.frontLang.sub": {
    ja: "カード表面と訳語の言語。学習コースとは別に選べます。",
    en: "The language of the card front and glosses. Chosen separately from the course.",
    ru: "Язык лицевой стороны и перевода. Выбирается отдельно от курса.",
  },
  "settings.section.unlock": { ja: "解除時間", en: "Unlock window", ru: "Окно разблокировки" },
  "settings.unlock.label": {
    ja: "クリア後にひらける時間",
    en: "Time unlocked after clearing",
    ru: "Время после прохождения",
  },
  "settings.unlock.sub": {
    ja: "この時間内に再度ゲートを開くとクイズをスキップ",
    en: "Reopening the gate within this window skips the quiz.",
    ru: "Повторный вход в окне пропускает викторину.",
  },
  "settings.unlock.minutes": { ja: "{m}分", en: "{m} min", ru: "{m} мин" },
  "settings.section.tts": { ja: "音声読み上げ", en: "Read aloud", ru: "Озвучивание" },
  "settings.tts.label": { ja: "{lang}を読み上げる", en: "Read {lang} aloud", ru: "Озвучивать: {lang}" },
  "settings.tts.sub": {
    ja: "カードを裏返した時に自動再生＋🔊で再再生",
    en: "Auto-plays when a card is flipped; 🔊 replays.",
    ru: "Автовоспроизведение при перевороте; 🔊 — повтор.",
  },
  "settings.tts.rateLabel": { ja: "読み上げ速度", en: "Speech rate", ru: "Скорость речи" },
  "settings.tts.rateSub": {
    ja: "新しい語はゆっくりが聞き取りやすい",
    en: "Slower is easier for new words.",
    ru: "Для новых слов удобнее медленнее.",
  },
  "settings.tts.rateNormal": { ja: "標準", en: "Normal", ru: "Обычно" },
  "settings.tts.noVoice": {
    ja: "この端末には{lang}の音声が見つかりません（端末の読み上げ音声設定で追加できる場合があります）。",
    en: "No {lang} voice found on this device (you may be able to add one in your device's text-to-speech settings).",
    ru: "На устройстве не найден голос ({lang}). Иногда его можно добавить в настройках синтеза речи.",
  },
  "settings.section.quizUI": { ja: "出題UI", en: "Quiz UI", ru: "Интерфейс викторины" },
  "settings.quiz.flashcard": { ja: "フラッシュカード", en: "Flashcards", ru: "Карточки" },
  "settings.quiz.flashcardSub": {
    ja: "タップで裏返し、フリックで自己評価。FSRSに直結。",
    en: "Tap to flip, flick to self-grade. Wired straight to FSRS.",
    ru: "Тап — переворот, свайп — самооценка. Напрямую в FSRS.",
  },
  "settings.quiz.strict": { ja: "厳格モード（4択）", en: "Strict mode (4-choice)", ru: "Строгий режим (4 варианта)" },
  "settings.quiz.strictSub": {
    ja: "Web版はまず反復テストが目的のため未実装（iOS版に温存）。",
    en: "Not built for web yet — the web build focuses on spaced repetition first (kept for iOS).",
    ru: "В веб-версии пока нет — упор на интервальные повторения (есть в iOS).",
  },
  "settings.section.data": { ja: "データ", en: "Data", ru: "Данные" },
  "settings.data.resetLabel": { ja: "学習状態をリセット", en: "Reset learning state", ru: "Сбросить прогресс" },
  "settings.data.resetSub": {
    ja: "FSRSスケジュール・ゲート履歴・設定を消去（dogfoodやり直し用）",
    en: "Erase FSRS schedule, gate history and settings (for a fresh dogfood run).",
    ru: "Удалить расписание FSRS, историю и настройки (для чистого прогона).",
  },
  "settings.data.resetBtn": { ja: "消去", en: "Erase", ru: "Стереть" },
  "settings.data.resetConfirm": {
    ja: "学習状態（FSRS・履歴・設定）をすべて消去します。よろしいですか？",
    en: "This erases all learning state (FSRS, history, settings). Continue?",
    ru: "Будет удалён весь прогресс (FSRS, история, настройки). Продолжить?",
  },
  "settings.shieldNote": {
    ja: "シールド（対象アプリの強制遮断）はiOSネイティブ専用機能のためWeb版にはありません。Web版はオートメーション方式（弱い強制力）で、クイズ×FSRSの反復UX検証に集中します。",
    en: "Shielding (hard-blocking a target app) is an iOS-native-only feature and isn't in the web build. The web build uses the automation approach (soft enforcement), focusing on validating the quiz × FSRS repetition UX.",
    ru: "Жёсткая блокировка приложений доступна только в iOS-версии. Веб-версия использует автоматизацию (мягкое ограничение) и проверяет UX повторений (викторина × FSRS).",
  },
  "settings.section.update": { ja: "アプリの更新", en: "App update", ru: "Обновление" },
  "settings.update.label": { ja: "最新版を確認", en: "Check for updates", ru: "Проверить обновления" },
  "settings.update.sub": {
    ja: "新しいビルドがあれば今すぐ取得して再読み込みします。何もしなければ次回このアプリを開いた時に自動で適用されます。",
    en: "Fetches and reloads a newer build now if there is one. Otherwise it applies automatically next time you open the app.",
    ru: "Загрузит и перезапустит новую сборку, если она есть. Иначе применится при следующем запуске.",
  },
  "settings.update.btn": { ja: "最新版に更新", en: "Update now", ru: "Обновить" },
  "settings.update.checking": { ja: "確認中…", en: "Checking…", ru: "Проверка…" },
  "settings.update.updating": {
    ja: "新しい版を適用します。まもなく再読み込みします…",
    en: "Applying the new version. Reloading shortly…",
    ru: "Применяем новую версию. Скоро перезагрузка…",
  },
  "settings.update.upToDate": {
    ja: "最新版です（ビルド: {v}）",
    en: "Up to date (build: {v})",
    ru: "Актуальная версия (сборка: {v})",
  },
  "settings.update.unsupported": {
    ja: "この環境では自動更新に対応していません（開発モード等）。",
    en: "Automatic updates aren't supported in this environment (e.g. dev mode).",
    ru: "Автообновление недоступно в этой среде (например, режим разработки).",
  },
  "settings.update.pending": {
    ja: "新しいバージョンがあります（次回起動時に適用）",
    en: "A new version is available (applies on next launch).",
    ru: "Доступна новая версия (применится при следующем запуске).",
  },
  "settings.build": { ja: "ビルド: {v}", en: "Build: {v}", ru: "Сборка: {v}" },

  // -- quiz -----------------------------------------------------------------
  "quiz.exit": { ja: "終了", en: "Exit", ru: "Выход" },
  "quiz.undo": { ja: "↩ 直前を取り消す", en: "↩ Undo last", ru: "↩ Отменить" },
  "quiz.complete.title": { ja: "{n}問クリア", en: "{n} cleared", ru: "{n} пройдено" },
  "quiz.complete.unlockMsg": {
    ja: "{min}分間ひらけます",
    en: "Unlocked for {min} min",
    ru: "Открыто на {min} мин",
  },
  "quiz.complete.practiceMsg": {
    ja: "今日の{lang}、進みました",
    en: "You made progress in {lang} today",
    ru: "Сегодня вы продвинулись: {lang}",
  },
  "quiz.breakdown.of": { ja: "{n}枚中", en: "of {n} cards", ru: "из {n} карт." },
  "quiz.breakdown.good": { ja: "覚えていた", en: "Knew it", ru: "Помнил" },
  "quiz.breakdown.hard": { ja: "曖昧", en: "Unsure", ru: "Смутно" },
  "quiz.breakdown.again": { ja: "覚えていない", en: "Didn't know", ru: "Не помнил" },
  "quiz.complete.returnTo": { ja: "{app}に戻る", en: "Back to {app}", ru: "Вернуться в {app}" },
  "quiz.complete.home": { ja: "ホームへ", en: "Home", ru: "На главную" },
  "quiz.complete.homeReturn": { ja: "ホームへ戻る", en: "Back to home", ru: "На главную" },
  "quiz.batch.title": { ja: "{n}セット目クリア", en: "Set {n} cleared", ru: "Сет {n} пройден" },
  "quiz.batch.sub": {
    ja: "続けるか、ここで終えるか選べます",
    en: "Keep going, or stop here.",
    ru: "Продолжить или закончить.",
  },
  "quiz.batch.continue": { ja: "続ける（次の10問）", en: "Continue (next 10)", ru: "Дальше (ещё 10)" },
  "quiz.batch.exit": { ja: "終了してホームへ", en: "Finish and go home", ru: "Закончить" },

  // -- gate -----------------------------------------------------------------
  "gate.unlockedTitle": { ja: "解除済み", en: "Already unlocked", ru: "Уже разблокировано" },
  "gate.unlockedMsg": {
    ja: "まだ解除ウィンドウ内です。そのまま戻れます。",
    en: "Still inside the unlock window — you can go straight back.",
    ru: "Ещё в окне разблокировки — можно сразу вернуться.",
  },

  // -- flashcard ------------------------------------------------------------
  "card.speak": { ja: "読み上げ", en: "Read aloud", ru: "Озвучить" },
  "card.tapToFlip": { ja: "タップして答えを見る", en: "Tap to see the answer", ru: "Нажмите, чтобы увидеть ответ" },
  "card.flick.again": { ja: "忘れた", en: "Forgot", ru: "Забыл" },
  "card.flick.hard": { ja: "曖昧", en: "Unsure", ru: "Смутно" },
  "card.flick.good": { ja: "覚えた", en: "Knew it", ru: "Помню" },
  "card.dir.left": { ja: "← 左", en: "← Left", ru: "← Влево" },
  "card.dir.down": { ja: "↓ 下", en: "↓ Down", ru: "↓ Вниз" },
  "card.dir.right": { ja: "→ 右", en: "→ Right", ru: "→ Вправо" },

  // -- verb aspect (card-back breakdown; follows UI language) ---------------
  "aspect.pf": { ja: "完了体", en: "perfective", ru: "сов. вид" },
  "aspect.impf": { ja: "不完了体", en: "imperfective", ru: "несов. вид" },
  "aspect.pairOf": { ja: "対", en: "pair", ru: "пара" },

  // -- part of speech (card-back breakdown; follows UI language) ------------
  "pos.verb": { ja: "動詞", en: "verb", ru: "глагол" },
  "pos.noun": { ja: "名詞", en: "noun", ru: "сущ." },
  "pos.adj": { ja: "形容詞", en: "adjective", ru: "прил." },
  "pos.adv": { ja: "副詞", en: "adverb", ru: "нареч." },
  "pos.num": { ja: "数詞", en: "numeral", ru: "числ." },
  "pos.predic": { ja: "述語", en: "predicative", ru: "предик." },
  "pos.pron": { ja: "代名詞", en: "pronoun", ru: "мест." },
  "pos.det": { ja: "限定詞", en: "determiner", ru: "детерм." },
  "pos.prep": { ja: "前置詞", en: "preposition", ru: "предлог" },
  "pos.conj": { ja: "接続詞", en: "conjunction", ru: "союз" },
  "pos.part": { ja: "助詞", en: "particle", ru: "частица" },

  // -- calibration ----------------------------------------------------------
  "calib.exit": { ja: "やめる", en: "Quit", ru: "Выйти" },
  "calib.done.finished": { ja: "仕分け完了", en: "Sorting complete", ru: "Разбор завершён" },
  "calib.done.judged": { ja: "{n}語 仕分けた", en: "Sorted {n} words", ru: "Разобрано слов: {n}" },
  "calib.done.knownUnknown": {
    ja: "知っている {k} ・ 知らない {u}",
    en: "Known {k} · Unknown {u}",
    ru: "Знаю {k} · Не знаю {u}",
  },
  "calib.done.progress": {
    ja: "全体の進捗 {j}/{t}",
    en: "Overall progress {j}/{t}",
    ru: "Общий прогресс {j}/{t}",
  },
  "calib.done.next50": { ja: "次の50語へ", en: "Next 50 words", ru: "Следующие 50 слов" },
  "calib.done.home": { ja: "ホームへ", en: "Home", ru: "На главную" },
  "calib.legend.unknown": { ja: "知らない", en: "Don't know", ru: "Не знаю" },
  "calib.legend.known": { ja: "知っている", en: "Know it", ru: "Знаю" },
  "calib.tapMeaning": { ja: "タップで意味（任意）", en: "Tap for meaning (optional)", ru: "Нажмите для значения (необяз.)" },
  "calib.overlay.known": { ja: "知ってる", en: "Know it", ru: "Знаю" },
  "calib.overlay.unknown": { ja: "知らない", en: "Don't know", ru: "Не знаю" },

  // -- automation guide -----------------------------------------------------
  "guide.title": { ja: "オートメーション設定", en: "Automation setup", ru: "Настройка автоматизации" },
  "guide.intro": {
    ja: "対象アプリを開くと自動でこのクイズが割り込む設定です（iPhone / iOSショートカット）。10問クリアすると対象アプリへ戻り、設定した時間だけ再割り込みしません。",
    en: "Makes this quiz interrupt automatically when you open a target app (iPhone / iOS Shortcuts). Clear 10 cards to return to the app; it won't interrupt again for the time you set.",
    ru: "Викторина будет всплывать при открытии выбранного приложения (iPhone / Быстрые команды iOS). После 10 карточек вы вернётесь в приложение, и какое-то время его не будут прерывать.",
  },
  "guide.section.steps": { ja: "手順", en: "Steps", ru: "Шаги" },
  "guide.step1": {
    ja: "「ショートカット」アプリを開き、下タブの**オートメーション**を選ぶ。",
    en: "Open the **Shortcuts** app and choose **Automation** in the bottom tab.",
    ru: "Откройте приложение **Быстрые команды** и выберите вкладку **Автоматизация**.",
  },
  "guide.step2": {
    ja: "右上の**＋**→**個人用オートメーションを作成**。",
    en: "Tap **+** (top right) → **Create Personal Automation**.",
    ru: "Нажмите **+** (справа вверху) → **Создать личную автоматизацию**.",
  },
  "guide.step3": {
    ja: "**App**を選び、**開いた時**にチェック→対象アプリ（例: TikTok）を選ぶ→次へ。",
    en: "Choose **App**, tick **Is Opened**, pick the target app (e.g. TikTok), then Next.",
    ru: "Выберите **Программа**, отметьте **Открыта**, укажите приложение (напр. TikTok), затем Далее.",
  },
  "guide.step4": {
    ja: "**アクションを追加**→**URLを開く**を選ぶ。",
    en: "**Add Action** → choose **Open URLs**.",
    ru: "**Добавить действие** → выберите **Открыть URL**.",
  },
  "guide.step5": {
    ja: "URL欄に下のアドレスを貼り付ける（**return=**の後ろを youtube / twitter などに変えれば他アプリ用も作れる）。",
    en: "Paste the address below into the URL field (change what follows **return=** to youtube / twitter etc. for other apps).",
    ru: "Вставьте адрес ниже в поле URL (меняя часть после **return=** на youtube / twitter и т. д. для других приложений).",
  },
  "guide.step6": {
    ja: "**即時に実行**をオン（確認を求めないにする）→完了。",
    en: "Turn on **Run Immediately** (no confirmation) → Done.",
    ru: "Включите **Запускать сразу** (без подтверждения) → Готово.",
  },
  "guide.section.url": { ja: "貼り付けるURL", en: "URL to paste", ru: "URL для вставки" },
  "guide.copyUrl": { ja: "URLをコピー", en: "Copy URL", ru: "Скопировать URL" },
  "guide.note": {
    ja: "注: 復帰は対象アプリのURLスキーム依存です（開けない場合は手動で戻ります）。ホーム画面に追加してスタンドアロン起動にすると割り込み感が自然になります。",
    en: "Note: returning depends on the target app's URL scheme (go back manually if it won't open). Adding this to your home screen for standalone launch makes the interruption feel more natural.",
    ru: "Примечание: возврат зависит от URL-схемы приложения (если не открывается, вернитесь вручную). Добавьте на экран «Домой» для отдельного запуска — прерывание ощущается естественнее.",
  },
};

/** Exposed for the completeness test only (every key must carry ja/en/ru). */
export const CATALOG = M;

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  let out = s;
  for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Pure lookup — usable outside React (tests, non-component modules). */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const entry = M[key];
  if (!entry) return interpolate(key, params);
  return interpolate(entry[lang] ?? entry.ja ?? key, params);
}

/** Localized name of a language for use inside a sentence (e.g. "Russian"). */
export function langName(lang: Lang, of: Lang): string {
  return translate(lang, `lang.name.${of}`);
}

export type TFn = (key: string, params?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  t: TFn;
  setLang: (lang: Lang) => void;
}

const I18nCtx = createContext<I18nValue>({
  lang: "ja",
  t: (k, p) => translate("ja", k, p),
  setLang: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ja");

  useEffect(() => {
    getAppLang().then(setLangState);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next); // immediate switch
    void setAppLang(next);
  }, []);

  const t = useCallback<TFn>((key, params) => translate(lang, key, params), [lang]);

  const value = useMemo<I18nValue>(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nCtx);
}

/** Convenience: just the translate function. */
export function useT(): TFn {
  return useContext(I18nCtx).t;
}
