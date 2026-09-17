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
import type { Lang, TargetLang } from "../content/courses";

export type { Lang, TargetLang };
export const UI_LANGS: Lang[] = ["ja", "en", "ru"];

/** Language display name in its OWN script (constant across UI languages) — for
 * language pickers and card kickers. Keyed by TargetLang, not Lang: a course's
 * target language needs a name in the picker even when the app has no UI in it
 * (LINGO-039's Thai). */
export const NATIVE_LANG_NAME: Record<TargetLang, string> = {
  ja: "日本語",
  en: "English",
  ru: "Русский",
  th: "ไทย",
};

/** One catalog row. Keyed by `Lang` (the languages the UI is translated into),
 * so adding a *course* target language like Thai costs nothing here — only
 * adding a UI language obliges 3-way translation of every key. */
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
  "common.close": { ja: "閉じる", en: "Close", ru: "Закрыть" },
  "badge.default": { ja: "既定", en: "Default", ru: "По умолч." },
  "badge.comingSoon": { ja: "準備中", en: "Coming soon", ru: "Скоро" },
  "badge.inUse": { ja: "使用中", en: "In use", ru: "Активно" },

  // -- localized language names (used inside sentences) ----------------------
  "lang.name.ja": { ja: "日本語", en: "Japanese", ru: "японский" },
  "lang.name.en": { ja: "英語", en: "English", ru: "английский" },
  "lang.name.ru": { ja: "ロシア語", en: "Russian", ru: "русский" },
  // LINGO-039: Thai is a course target language only — there is no Thai UI, so
  // it needs a NAME in all three catalogs (course picker, "learn {lang}"
  // sentences) but no catalog of its own. See TargetLang in content/courses.ts.
  "lang.name.th": { ja: "タイ語", en: "Thai", ru: "тайский" },

  // -- home (LINGO-040) -----------------------------------------------------
  // Three permanent blocks only — course + streak / what to do today / one
  // progress bar. Everything that used to sit here (session tiles, vocabulary
  // coverage, retention, the four-number promotion readout) either moved into
  // the "くわしく" sheet or was deleted outright. The vocabulary is deliberately
  // free of the app's internals: no band, no gate, no unlock, no coverage, no
  // retention, no card counts as denominators (Fable ruling LINGO-040 §2/§3).
  "home.settings": { ja: "設定", en: "Settings", ru: "Настройки" },
  // Block 1 — which language is being learned, and the streak.
  "home.course.sheetTitle": { ja: "学ぶ言語", en: "Language you're learning", ru: "Язык, который учите" },
  "home.course.switchConfirm": {
    ja: "{lang}に切り替えますか？ いまのコースの進み具合はそのまま残ります。",
    en: "Switch to {lang}? Your progress in the current course is kept.",
    ru: "Переключиться на {lang}? Прогресс текущего курса сохранится.",
  },
  "home.streak": { ja: "{n}日つづけて", en: "{n}-day streak", ru: "{n} дней подряд" },
  // Block 2 — the single thing to do today.
  "home.today.title": { ja: "今日やること", en: "Today", ru: "Сегодня" },
  // LINGO-046 (勝田要望): "復習 8枚 ＋ 新しい単語" told the learner what the app
  // had queued, not what they were being asked to do, and gave them nothing to
  // finish. The card now leads with a distance to a target they chose —
  // "あと22問" — and the mix is demoted to a supporting line.
  "home.today.remaining": { ja: "あと{n}問", en: "{n} to go", ru: "Осталось {n}" },
  "home.today.goal": { ja: "今日の目標 {n}問", en: "Today's goal: {n}", ru: "Цель на сегодня: {n}" },
  "home.today.ofWhichReviews": {
    ja: "うち復習 {n}枚",
    en: "including {n} reviews",
    ru: "из них повторений: {n}",
  },
  "home.today.freshOnly": {
    ja: "新しい単語からはじめます",
    en: "Starting with new words",
    ru: "Начнём с новых слов",
  },
  "home.today.achieved": {
    ja: "今日の目標達成！",
    en: "Goal reached for today!",
    ru: "Цель на сегодня выполнена!",
  },
  // Passing the goal is not the end of the day — the count keeps going, so
  // someone on a roll is never told to stop.
  "home.today.beyond": { ja: "目標＋{n}問", en: "{n} past your goal", ru: "+{n} сверх цели" },
  "home.today.start": { ja: "{n}問はじめる", en: "Start {n} questions", ru: "Начать: {n} заданий" },
  "home.today.continue": { ja: "＋{n}問つづける", en: "Keep going: {n} more", ru: "Ещё {n} заданий" },
  // Block 3 — one bar, aimed at the next 500-word milestone.
  "home.progress.learned": { ja: "覚えた語", en: "Words learned", ru: "Выучено слов" },
  "home.progress.words": { ja: "{n}語", en: "{n} words", ru: "Слов: {n}" },
  // LINGO-046: the headline count is rounded down to a round ten. A precise
  // "275語" invites the reader to ask what the 5 means, and the honest answer
  // is "nothing you can rely on" — see engine/mastery.ts approximateWordCount.
  // The details sheet still shows the exact figure.
  "home.progress.approxWords": { ja: "約{n}語", en: "about {n} words", ru: "около {n} слов" },
  // LINGO-042 (勝田指示): the 500-word milestone line is gone. It sat directly
  // above "次のステップまで あとN語" and the two goals competed — the whole
  // point of LINGO-040 was to leave exactly one thing to aim at. The bar now
  // tracks the current step, and the step line is the only goal on screen.
  // "ステップ" replaces band/語帯 everywhere a learner can see it. The word
  // count is rounded and marked 約: the real per-step totals are 1000/1000/1000
  // on RU (LINGO-043; were 998/995/967 before that band-size normalization),
  // and printing those raw was exactly the confusion this ticket fixes
  // (the exact figures live in the details sheet).
  "home.step.title": {
    ja: "ステップ{step}（最初の約{n}語）",
    en: "Step {step} — the first ~{n} words",
    ru: "Этап {step} — первые ~{n} слов",
  },
  "home.step.toNext": {
    ja: "次のステップまで あと{n}語",
    en: "{n} more words to the next step",
    ru: "До следующего этапа: ещё {n} слов",
  },
  "home.step.keepReviewing": {
    ja: "復習を続けると次のステップへ",
    en: "Keep reviewing to reach the next step",
    ru: "Продолжайте повторять — и откроется следующий этап",
  },
  "home.step.last": {
    ja: "いまが最後のステップです",
    en: "This is the last step",
    ru: "Это последний этап",
  },
  "home.details": { ja: "くわしく", en: "Details", ru: "Подробнее" },
  // LINGO-050: the マイノート lane. Katsuta's own note/lesson imports used to
  // appear unannounced among the first thousand words; they now have their own
  // door. Deliberately quiet — it is optional practice, not the main line —
  // and hidden entirely on a course that ships no notes.
  "home.notes.label": { ja: "マイノート", en: "My notes", ru: "Мои заметки" },
  "home.notes.sub": {
    ja: "取り込んだメモ・レッスンから{n}問",
    en: "{n} cards from your imported notes and lessons",
    ru: "{n} карточек из ваших заметок и уроков",
  },
  // Block 2, first-run variant: before the level check there is nothing
  // meaningful to review, so the level check IS the one thing to do today
  // (it replaces the block rather than adding a fourth one).
  "home.calib.title": {
    ja: "はじめる前に",
    en: "Before you start",
    ru: "Перед началом",
  },
  "home.calib.desc": {
    ja: "知っている単語を教えてください。知っている語を右、知らない語を左へ。",
    en: "Tell us which words you already know. Swipe right for the ones you know, left for the ones you don't.",
    ru: "Отметьте слова, которые уже знаете. Знакомые — вправо, незнакомые — влево.",
  },
  // LINGO-016: adaptive placement test replaces the old fixed 1000-word triage
  // (home.calib.continue/start retired — the new test is a single short pass,
  // not a resumable batch job).
  "home.placement.cta": {
    ja: "レベルチェック（約1〜3分）",
    en: "Level check (~1–3 min)",
    ru: "Проверка уровня (~1–3 мин)",
  },
  "home.calib.later": {
    ja: "あとで（すぐ始める）",
    en: "Later — just start",
    ru: "Позже — сразу начать",
  },

  // -- home details sheet (LINGO-040) ---------------------------------------
  // Everything precise lives here, because only someone who tapped "くわしく"
  // is asking for precision. Exact denominators are allowed on this screen.
  "detail.today": { ja: "今日の学習", en: "Today's study", ru: "Занятия сегодня" },
  "detail.today.sessions": { ja: "{n}セッション", en: "{n} sessions", ru: "Подходов: {n}" },
  "detail.learned.declared": {
    ja: "レベルチェックで申告",
    en: "Declared in the level check",
    ru: "Отмечено на проверке уровня",
  },
  "detail.learned.studied": { ja: "学習で定着", en: "Learned through study", ru: "Закреплено занятиями" },
  "detail.frame": { ja: "よく使う3,000語のうち", en: "Of the 3,000 everyday words", ru: "Из 3 000 частотных слов" },
  "detail.speech": {
    ja: "日常会話でよく出る語",
    en: "Everyday speech covered",
    ru: "Охват повседневной речи",
  },
  "detail.speech.value": { ja: "約{pct}%（目安）", en: "about {pct}% (estimate)", ru: "около {pct} % (оценка)" },
  "detail.introduced": { ja: "学習を始めた語", en: "Words introduced", ru: "Начатые слова" },
  // LINGO-042: was "{n}語 / {total}語", which put the raw 998 back on screen —
  // the exact internal denominator this whole redesign exists to hide (ruling
  // §3). The bar underneath already shows the proportion; the number only ever
  // needs to say how far the learner has come.
  "detail.introduced.value": { ja: "{n}語", en: "{n} words", ru: "Слов: {n}" },
  "detail.retention": { ja: "復習の成功率", en: "Review success", ru: "Успешных повторений" },
  "detail.retention.noData": {
    ja: "復習をはじめると出ます",
    en: "Shows up after your first reviews",
    ru: "Появится после первых повторений",
  },
  "detail.next": { ja: "次のステップまで", en: "To the next step", ru: "До следующего этапа" },
  // LINGO-042: the value used to reuse home.step.toNext, which already begins
  // with "次のステップまで" — so the row read "次のステップまで / 次のステップ
  // まで あと899語". The sheet needs the bare remainder, the label supplies the
  // rest.
  "detail.next.value": { ja: "あと{n}語", en: "{n} more words", ru: "ещё {n} слов" },

  // -- mastery level ladder --------------------------------------------------
  // LINGO-040: "マスター" is gone from the product's vocabulary — it promised
  // completion for words the learner had merely ticked in a 1–3 minute check.
  "mastery.level.beginner": { ja: "完全初心者", en: "Absolute beginner", ru: "Начинающий" },
  "mastery.level.words": { ja: "およそ{n}語", en: "about {n} words", ru: "около {n} слов" },

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

  // -- backup export/import (LINGO-021) --------------------------------------
  "settings.backup.export.label": {
    ja: "学習データをエクスポート",
    en: "Export learning data",
    ru: "Экспортировать данные обучения",
  },
  "settings.backup.export.sub": {
    ja: "全コースの進捗と設定をJSONファイルでダウンロードします",
    en: "Downloads every course's progress and settings as a JSON file.",
    ru: "Скачает прогресс по всем курсам и настройки в файл JSON.",
  },
  "settings.backup.export.btn": { ja: "エクスポート", en: "Export", ru: "Экспорт" },
  "settings.backup.import.label": {
    ja: "学習データをインポート",
    en: "Import learning data",
    ru: "Импортировать данные обучения",
  },
  "settings.backup.import.sub": {
    ja: "エクスポートしたJSONファイルから復元します",
    en: "Restores from a previously exported JSON file.",
    ru: "Восстановит данные из ранее экспортированного файла JSON.",
  },
  "settings.backup.import.btn": { ja: "ファイルを選択", en: "Choose file", ru: "Выбрать файл" },
  "settings.backup.import.importing": { ja: "復元中…", en: "Restoring…", ru: "Восстановление…" },
  "settings.backup.import.replaceAll": {
    ja: "すべて置き換える（既存データを削除して復元）",
    en: "Replace everything (deletes existing data before restoring)",
    ru: "Заменить всё (удалит текущие данные перед восстановлением)",
  },
  "settings.backup.import.confirmReplace": {
    ja: "既存の学習データがすべて削除され、選択したファイルの内容に置き換わります。よろしいですか？",
    en: "This deletes all existing learning data and replaces it with the selected file's contents. Continue?",
    ru: "Все текущие данные обучения будут удалены и заменены содержимым выбранного файла. Продолжить?",
  },
  "settings.backup.import.success": {
    ja: "復元が完了しました。再読み込みします…",
    en: "Restore complete. Reloading…",
    ru: "Восстановление завершено. Перезагрузка…",
  },
  "settings.backup.import.error.invalid": {
    ja: "ファイルの形式が正しくありません",
    en: "This file's format isn't valid.",
    ru: "Неверный формат файла.",
  },
  "settings.backup.import.error.unsupportedVersion": {
    ja: "このファイルは新しいバージョンのアプリ用です。アプリを更新してから再度お試しください",
    en: "This file was made by a newer app version. Please update the app and try again.",
    ru: "Файл создан более новой версией приложения. Обновите приложение и попробуйте снова.",
  },

  // -- storage protection status (LINGO-021, shown small at the bottom) -----
  "settings.storage.protected": { ja: "保護済み", en: "Protected", ru: "Защищено" },
  "settings.storage.unprotected": { ja: "未保護", en: "Not protected", ru: "Не защищено" },
  "settings.storage.unknown": { ja: "状態不明", en: "Status unknown", ru: "Статус неизвестен" },
  "settings.storage.usage": {
    ja: "ストレージ: {used} / {quota}",
    en: "Storage: {used} / {quota}",
    ru: "Хранилище: {used} / {quota}",
  },
  "settings.storage.usageOnly": {
    ja: "ストレージ: {used}",
    en: "Storage: {used}",
    ru: "Хранилище: {used}",
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
  // LINGO-026: was a hardcoded full-width （）paren template regardless of UI
  // language, appended in code after settings.build.
  "settings.buildAt": { ja: "（{at}）", en: " ({at})", ru: " ({at})" },

  // -- quiz -----------------------------------------------------------------
  "quiz.exit": { ja: "終了", en: "Exit", ru: "Выход" },
  "quiz.undo": { ja: "↩ 直前を取り消す", en: "↩ Undo last", ru: "↩ Отменить" },
  "quiz.complete.title": { ja: "{n}問クリア", en: "{n} cleared", ru: "{n} пройдено" },
  "quiz.complete.unlockMsg": {
    ja: "これで{min}分間、アプリが使えます",
    en: "The app stays open for {min} min",
    ru: "Приложение открыто на {min} мин",
  },
  "quiz.complete.practiceMsg": {
    ja: "今日の{lang}、進みました",
    en: "You made progress in {lang} today",
    ru: "Сегодня вы продвинулись: {lang}",
  },
  // LINGO-024: shown on the complete screen when a session just crossed the
  // promotion threshold — {band} is the newly-unlocked band, {n} its word
  // count (band*1000).
  // LINGO-040: "band{n}解放" was the app's internal name for a curriculum
  // tier, printed verbatim at the single most celebratory moment in the
  // product. The fake word count (band × 1000) is dropped too — the real
  // per-step totals differ per course.
  "quiz.complete.bandPromoted": {
    ja: "ステップ{band}が開きました！",
    en: "Step {band} is open!",
    ru: "Этап {band} открыт!",
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
  // LINGO-040 (ruling §4③): "解除ウィンドウ" told the learner nothing. The
  // gate is explained in the only terms that matter at that moment — the app
  // is open, and why.
  "gate.unlockedTitle": { ja: "もう開いています", en: "Already open", ru: "Уже открыто" },
  "gate.unlockedMsg": {
    ja: "さっき学習したので、そのまま戻れます。",
    en: "You studied a moment ago — go straight back.",
    ru: "Вы только что занимались — можно сразу вернуться.",
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
  // LINGO-025: every verb shows aspect info; these cover the "not a strict
  // pair" cases so a bare "no pair" never appears on the card back.
  "aspect.both": { ja: "両体動詞", en: "biaspectual", ru: "двувидовой" },
  "aspect.related": { ja: "関連", en: "related", ru: "связано" },
  "aspect.noPair": { ja: "対なし", en: "no pair", ru: "нет пары" },
  "aspect.always": { ja: "常に", en: "always ", ru: "всегда " },

  // -- noun gender (card-back breakdown; follows UI language) LINGO-022 -----
  "gender.m": { ja: "男性名詞", en: "masculine noun", ru: "муж. род" },
  "gender.f": { ja: "女性名詞", en: "feminine noun", ru: "жен. род" },
  "gender.n": { ja: "中性名詞", en: "neuter noun", ru: "ср. род" },
  "gender.pl": { ja: "複数のみ", en: "plural only", ru: "только мн. ч." },
  "gender.mf": { ja: "通性名詞", en: "common gender", ru: "общий род" },

  // -- grammatical case in text (card-back breakdown) LINGO-033 -----------
  "case.form": { ja: "文中の形", en: "form in the sentence", ru: "форма в тексте" },
  "case.1": { ja: "1格・主格", en: "case 1 (nominative)", ru: "именительный (1-й)" },
  "case.2": { ja: "2格・生格", en: "case 2 (genitive)", ru: "родительный (2-й)" },
  "case.3": { ja: "3格・与格", en: "case 3 (dative)", ru: "дательный (3-й)" },
  "case.4": { ja: "4格・対格", en: "case 4 (accusative)", ru: "винительный (4-й)" },
  "case.5": { ja: "5格・造格", en: "case 5 (instrumental)", ru: "творительный (5-й)" },
  "case.6": { ja: "6格・前置格", en: "case 6 (prepositional)", ru: "предложный (6-й)" },

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
  // LINGO-026: was missing entirely (38 RU words — спасибо/привет/etc. — fell
  // through to the raw untranslated "intj" string in all 3 UI languages).
  "pos.intj": { ja: "感動詞", en: "interjection", ru: "межд." },
  // LINGO-039: Thai-specific and unavoidable — you cannot count anything in
  // Thai without the right classifier ("sɔ̌ɔng khon" = two people), so these
  // are core band1 vocabulary rather than a curiosity, and they get a real POS
  // instead of being flattened into `noun`. i18nLeak.test.ts asserts every pos
  // code present in any shipped deck has a key here.
  "pos.classifier": { ja: "類別詞", en: "classifier", ru: "классиф." },

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

  // -- adaptive placement test (LINGO-016) -----------------------------------
  // Reuses calib.legend.*/calib.tapMeaning/calib.overlay.*/calib.exit — same
  // right=know/left=don't-know swipe card, so no separate labels needed there.
  "placement.blockLabel": { ja: "ブロック {n}", en: "Block {n}", ru: "Блок {n}" },
  // LINGO-018 (Katsuta feedback 2026-08-28): reveal shows "意味" (this word's
  // own gloss) then a clearly-labelled "例:" (example) line, instead of the
  // old unlabelled example-sentence-only reveal that read like the sentence
  // itself was the word's meaning.
  "placement.card.example": { ja: "例:", en: "Example:", ru: "Пример:" },
  "placement.finalizing": {
    ja: "結果を保存中…",
    en: "Saving your results…",
    ru: "Сохраняем результат…",
  },
  "placement.block.estimateTitle": {
    ja: "現在の推定",
    en: "Current estimate",
    ru: "Текущая оценка",
  },
  "placement.block.estimateLine": {
    ja: "約{n}語マスター相当（±{err}）",
    en: "~{n} words mastered (±{err})",
    ru: "≈{n} слов освоено (±{err})",
  },
  "placement.block.continue": {
    ja: "続ける（精度が上がります）",
    en: "Continue (more precise)",
    ru: "Продолжить (точнее)",
  },
  "placement.block.finish": { ja: "ここで始める", en: "Start here", ru: "Начать здесь" },
  "placement.beginner.title": {
    ja: "完全初心者として開始します",
    en: "Starting as an absolute beginner",
    ru: "Начинаем с полного нуля",
  },
  "placement.beginner.desc": {
    ja: "基礎から着実に学びます。",
    en: "You'll build up from the basics.",
    ru: "Начнём с самых основ.",
  },
  "placement.result.title": {
    ja: "レベルチェック完了",
    en: "Level check complete",
    ru: "Проверка уровня завершена",
  },
  "placement.result.summary": {
    ja: "約{n}語マスター相当（{level}）",
    en: "~{n} words mastered ({level})",
    ru: "≈{n} слов освоено ({level})",
  },
  // 2026-09-09 fix: confirms the estimate above already landed in Home's
  // mastery count (not just a preview) — most relevant right after a retake,
  // so the number visibly having moved isn't a mystery.
  "placement.result.masteryUpdated": {
    ja: "マスター指標に反映されました",
    en: "Reflected in your mastery count",
    ru: "Учтено в показателе освоения",
  },
  "placement.result.startLearning": {
    ja: "学習を始める",
    en: "Start learning",
    ru: "Начать обучение",
  },

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

  // -- onboarding (LINGO-017, design §3.5 — copy confirmed, used verbatim) --
  "onboard.next": { ja: "次へ", en: "Next", ru: "Далее" },
  "onboard.back": { ja: "戻る", en: "Back", ru: "Назад" },
  "onboard.skip": { ja: "スキップ", en: "Skip", ru: "Пропустить" },

  "onboard.screen1.title": {
    ja: "単語帳の後ろ半分は、まだ要らない",
    en: "You don't need the back half of the dictionary yet",
    ru: "Вторая половина словаря пока не нужна",
  },
  "onboard.screen1.body": {
    ja: "日常会話の85%は、最もよく使われる1,000語でできています。2,000語で90%、3,000語で約95%——ここまで来ると会話がストレスなく理解できる水準です（言語研究の実測値）。このアプリは、その順番どおりにだけ覚えます。",
    en: "85% of everyday conversation is built from just the 1,000 most common words. 2,000 words gets you to 90%, and 3,000 to about 95% — the point where conversation stops feeling stressful to follow (based on real language research). This app teaches words in exactly that order.",
    ru: "85% повседневной речи состоит всего из 1000 самых частых слов. 2000 слов дают 90%, а 3000 — около 95%: с этого уровня понимать речь становится комфортно (по данным лингвистических исследований). Это приложение учит слова именно в таком порядке.",
  },

  "onboard.screen2.title": {
    ja: "あなたが既に知っている単語は、飛ばす",
    en: "Words you already know get skipped",
    ru: "Слова, которые вы уже знаете, пропускаются",
  },
  "onboard.screen2.body": {
    ja: "最初に短いテストであなたの語彙の境界線を見つけます。知っている単語には時間を使いません。あなた専用の『まだ知らない重要語』リストだけが残ります。",
    en: "A short test first finds the edge of your vocabulary. No time is spent on words you already know — what's left is your own list of important words you don't know yet.",
    ru: "Сначала короткий тест находит границу вашего словарного запаса. Время не тратится на слова, которые вы уже знаете — остаётся только ваш личный список важных незнакомых слов.",
  },

  "onboard.screen3.title": {
    ja: "忘れる直前に、もう一度会う",
    en: "You'll see it again right before you forget",
    ru: "Повторение — прямо перед тем, как забудете",
  },
  "onboard.screen3.body": {
    ja: "人は覚えた直後から忘れ始めます。このアプリは一枚ごとに『あなたがいつ忘れそうか』を計算し、忘れる直前に再出題します（FSRSという記憶モデル）。復習のタイミングはすべて自動です。",
    en: "We start forgetting the moment we learn something. This app calculates when you're about to forget each card and brings it back just in time (a memory model called FSRS). All review timing is automatic.",
    ru: "Забывание начинается сразу после запоминания. Приложение рассчитывает, когда вы вот-вот забудете каждую карточку, и показывает её снова точно вовремя (модель памяти FSRS). Расписание повторений — полностью автоматическое.",
  },

  "onboard.screen4.title": {
    ja: "新しい単語は、1文に1つだけ",
    en: "Only one new word per sentence",
    ru: "Только одно новое слово в предложении",
  },
  "onboard.screen4.body": {
    ja: "知らない単語だらけの文は覚えられません。ここでは『ほぼ全部読めるのに、1語だけ新しい』文だけが出ます（未知語は最大でも2語まで）。文脈が新しい単語を記憶に固定します。",
    en: "A sentence full of unknown words can't stick. Here you'll only see sentences that are almost entirely readable, with just one new word (at most two unknowns). Context is what locks a new word into memory.",
    ru: "Предложение, полное незнакомых слов, не запомнится. Здесь вы увидите только предложения, которые почти полностью понятны, с одним новым словом (максимум два незнакомых). Контекст закрепляет новое слово в памяти.",
  },

  "onboard.screen5.title": {
    ja: "スマホの誘惑を、学習に変える",
    en: "Turn phone temptation into learning",
    ru: "Превратите тягу к телефону в учёбу",
  },
  "onboard.screen5.body": {
    ja: "SNSなどを開こうとしたタイミングでこのアプリが割り込み、数問答えるだけで元のアプリに戻れます（設定はあとからでも変更できます）。",
    en: "When you open apps like social media, this app can step in first — answer a few questions and you're back to what you were doing (you can set this up anytime later).",
    ru: "Когда вы открываете соцсети и подобные приложения, это приложение может ненадолго вмешаться — ответьте на несколько вопросов и вернётесь к своим делам (это можно настроить в любой момент позже).",
  },
  "onboard.screen5.cta": {
    ja: "レベルチェックを始める",
    en: "Start the level check",
    ru: "Начать проверку уровня",
  },

  "onboard.course.title": {
    ja: "何を学びますか？",
    en: "What do you want to learn?",
    ru: "Что вы хотите изучать?",
  },
  "onboard.course.frontNote": {
    ja: "ヒントの言語はあなたのアプリ言語（{lang}）に自動で設定されます。設定からいつでも変更できます。",
    en: "Hints will start in your app language ({lang}). You can change this anytime in Settings.",
    ru: "Подсказки будут на языке приложения ({lang}). Это можно изменить в любой момент в настройках.",
  },
  "onboard.course.skip": { ja: "あとで選ぶ", en: "Choose later", ru: "Выбрать позже" },

  "settings.viewOnboarding": {
    ja: "アプリの説明を見る",
    en: "View the app intro",
    ru: "Посмотреть введение",
  },

  // -- level check entry point (2026-09-09 fix): the adaptive placement test
  // (LINGO-016) was only reachable from a Home CTA that hides once
  // judged<100 words — invisible to anyone who partly did the old linear
  // calibration flow. A permanent Settings entry lets it be taken or retaken
  // any time, per course. -------------------------------------------------
  "settings.section.placement": { ja: "レベルチェック", en: "Level check", ru: "Проверка уровня" },
  "settings.placement.start": {
    ja: "レベルチェックを受ける",
    en: "Take the level check",
    ru: "Пройти проверку уровня",
  },
  "settings.placement.redo": {
    ja: "レベルチェックをやり直す",
    en: "Retake the level check",
    ru: "Пройти проверку уровня заново",
  },
  "settings.placement.sub": {
    ja: "約1〜3分。学習履歴はそのまま、推定だけ更新します。",
    en: "About 1–3 min. Updates your estimate without touching your learning history.",
    ru: "~1–3 мин. Обновляет оценку, не затрагивая историю обучения.",
  },

  // -- daily goal (LINGO-046) ----------------------------------------------
  "settings.section.dailyGoal": { ja: "1日の目標", en: "Daily goal", ru: "Цель на день" },
  "settings.dailyGoal.label": { ja: "1日に解く問題数", en: "Questions per day", ru: "Заданий в день" },
  // No {n} here on purpose: the ListPicker row already shows the current value
  // on its right-hand side, so repeating it in the subtitle just says the same
  // number twice.
  "settings.dailyGoal.sub": {
    ja: "ホームの「あと◯問」の基準になります。いつでも変えられます。",
    en: "Sets the target Home counts down to. Change it whenever you like.",
    ru: "Задаёт цель, до которой считает главный экран. Можно изменить в любой момент.",
  },
  "settings.dailyGoal.questions": { ja: "{n}問", en: "{n} questions", ru: "{n} заданий" },

  // -- on-device diagnostics (LINGO-047) ------------------------------------
  // Intentionally untranslated VALUES (they are raw browser numbers), but the
  // framing is localised so the screen is not a wall of English on a JA phone.
  "settings.section.diagnostics": { ja: "診断", en: "Diagnostics", ru: "Диагностика" },
  "settings.diagnostics.label": {
    ja: "画面の実測値",
    en: "Screen measurements",
    ru: "Измерения экрана",
  },
  "settings.diagnostics.sub": {
    ja: "表示の不具合を報告するときに、この画面のスクショを送ってください。",
    en: "Screenshot this when reporting a display problem.",
    ru: "Пришлите скриншот этого экрана, если что-то отображается неверно.",
  },
  "settings.diagnostics.hint": {
    ja: "赤い行は、一致するはずの値がズレていることを示します。",
    en: "A highlighted row means two values that should agree do not.",
    ru: "Подсвеченная строка: значения, которые должны совпадать, различаются.",
  },

  // -- app lock (LINGO-040): the automation guide, moved off Home. It needs
  // iOS Shortcuts knowledge to act on, so it belongs where someone goes
  // looking for it — not next to the one button a first-time user must press.
  "settings.section.appLock": {
    ja: "アプリのロック",
    en: "App lock",
    ru: "Блокировка приложений",
  },
  "settings.appLock.label": {
    ja: "アプリのロックを設定",
    en: "Set up app lock",
    ru: "Настроить блокировку",
  },
  "settings.appLock.sub": {
    ja: "SNSを開いたときに、先に学習を出すようにできます。",
    en: "Make a quick study session appear before a social app opens.",
    ru: "Короткое занятие перед открытием соцсети.",
  },

  // -- bottom tab bar (LINGO-030) -------------------------------------------
  "tab.learn": { ja: "学習", en: "Learn", ru: "Учёба" },
  "tab.raise": { ja: "育成", en: "Raise", ru: "Питомец" },

  // -- pet / 育成 (LINGO-030) ------------------------------------------------
  "pet.title": { ja: "育成", en: "Raise", ru: "Питомец" },
  "pet.loading": { ja: "読み込み中…", en: "Loading…", ru: "Загрузка…" },
  "pet.stage.egg": { ja: "タマゴ", en: "Egg", ru: "Яйцо" },
  "pet.stage.baby": { ja: "幼年期", en: "Baby", ru: "Малыш" },
  "pet.stage.child": { ja: "成長期", en: "Growth", ru: "Рост" },
  "pet.stage.adult": { ja: "成熟期", en: "Mature", ru: "Зрелость" },
  "pet.stage.perfect": { ja: "完全体", en: "Perfect", ru: "Совершенство" },
  "pet.stage.ultimate": { ja: "究極体", en: "Ultimate", ru: "Абсолют" },
  // {stage} = localized stage name, {age} = whole days, {gen} = generation no.
  "pet.meta": {
    ja: "{stage}・{age}日目・{gen}代目",
    en: "{stage} · day {age} · gen {gen}",
    ru: "{stage} · день {age} · пок. {gen}",
  },
  "pet.gauge.satiety": { ja: "満腹度", en: "Fullness", ru: "Сытость" },
  "pet.gauge.cleanliness": { ja: "清潔さ", en: "Cleanliness", ru: "Чистота" },
  "pet.poop.label": { ja: "うんこ {n}/{max}", en: "Poop {n}/{max}", ru: "Какашки {n}/{max}" },
  "pet.poop.none": { ja: "きれい", en: "All clean", ru: "Чисто" },
  "pet.action.feed": { ja: "餌をあげる", en: "Feed", ru: "Покормить" },
  "pet.action.clean": { ja: "掃除する", en: "Clean", ru: "Убрать" },
  // LINGO-034 (2026-09-07): pocket caps — shown as "n/max" like poop.label,
  // so the ceiling is always visible (not just the count).
  "pet.owned.food": { ja: "餌 {n}/{max}", en: "Food {n}/{max}", ru: "Еда {n}/{max}" },
  "pet.owned.cleanPts": { ja: "掃除P {n}/{max}", en: "Clean pts {n}/{max}", ru: "Очки {n}/{max}" },
  "pet.streak": { ja: "連続学習 {n}日", en: "{n}-day streak", ru: "Серия: {n} дн." },
  "pet.name.placeholder": { ja: "名前をつける", en: "Name your pet", ru: "Дать имя" },
  "pet.name.save": { ja: "決定", en: "Save", ru: "Готово" },
  "pet.name.cancel": { ja: "キャンセル", en: "Cancel", ru: "Отмена" },
  "pet.name.title": { ja: "名前をつける", en: "Name your pet", ru: "Имя питомца" },
  "pet.dex.open": { ja: "図鑑を見る", en: "Collection", ru: "Коллекция" },
  "pet.dex.title": { ja: "図鑑", en: "Collection", ru: "Коллекция" },
  "pet.dex.count": { ja: "{found}/{total} 種発見", en: "{found}/{total} discovered", ru: "Открыто {found}/{total}" },
  "pet.dex.unknown": { ja: "？？？", en: "???", ru: "???" },
  "pet.dex.back": { ja: "‹ 育成へ", en: "‹ Back", ru: "‹ Назад" },
  "pet.hardMode.label": { ja: "ハードモード", en: "Hard mode", ru: "Хардкор" },
  "pet.hardMode.sub": {
    ja: "放置で去る演出を「死亡」に変えます",
    en: "Frames an early exit as death, not departure.",
    ru: "Ранний уход показывается как гибель, а не прощание.",
  },

  // -- pet sleep window (LINGO-035, 2026-09-08) ------------------------------
  "pet.sleep.start.label": { ja: "就寝時刻", en: "Bedtime", ru: "Время сна" },
  "pet.sleep.end.label": { ja: "起床時刻", en: "Wake time", ru: "Время подъёма" },
  "pet.sleep.sub": {
    ja: "この間は満腹度が減らず、うんこも出ません",
    en: "Fullness won't drop and no poop appears during this window.",
    ru: "В это время сытость не падает и какашки не появляются.",
  },
  "pet.sleeping": { ja: "おやすみ中…そっとしておこう", en: "Sleeping… let it rest", ru: "Спит… не будите" },

  // -- pet events (hatch / evolve / depart) ---------------------------------
  "pet.event.hatch.title": { ja: "タマゴがかえった！", en: "It hatched!", ru: "Вылупился!" },
  "pet.event.hatch.body": {
    ja: "{name} が生まれました。世話をして育てよう。",
    en: "{name} was born. Care for it as it grows.",
    ru: "{name} появился. Заботьтесь о нём.",
  },
  "pet.event.evolve.title": { ja: "進化した！", en: "Evolved!", ru: "Эволюция!" },
  "pet.event.evolve.body": {
    ja: "{name} に進化した！世話の質が姿に表れます。",
    en: "Evolved into {name}! Your care shows in its form.",
    ru: "Превратился в {name}! Забота отражается в облике.",
  },
  "pet.event.depart.title": { ja: "旅立ち", en: "A farewell", ru: "Прощание" },
  "pet.event.depart.body": {
    ja: "{name} は旅立ちました。図鑑に記録され、新しいタマゴが残されました。",
    en: "{name} has departed — recorded in your collection, and a new egg was left behind.",
    ru: "{name} отправился в путь — записан в коллекцию, и осталось новое яйцо.",
  },
  "pet.event.death.title": { ja: "力尽きた…", en: "It didn't make it…", ru: "Не выжил…" },
  "pet.event.death.body": {
    ja: "{name} は力尽きました。図鑑に記録され、新しいタマゴが残されました。",
    en: "{name} didn't make it — recorded in your collection, and a new egg was left behind.",
    ru: "{name} не выжил — записан в коллекцию, и осталось новое яйцо.",
  },
  "pet.event.ok": { ja: "つづける", en: "Continue", ru: "Дальше" },

  // -- study → pet earnings (LINGO-031) -------------------------------------
  "pet.earn.summary": {
    ja: "🍖 餌 +{food} ／ 🧹 掃除P +{clean}",
    en: "🍖 Food +{food} · 🧹 Clean pts +{clean}",
    ru: "🍖 Еда +{food} · 🧹 Очков +{clean}",
  },
  "pet.earn.goTo": { ja: "育成タブへ", en: "Go to Raise", ru: "К питомцу" },
  // LINGO-034 (2026-09-07): shown when the pocket cap discarded part of this
  // session's earnings — reassuring tone, never framing the studying itself
  // as wasted (the session still counted for everything else: streak, band
  // progress, mastery).
  "pet.earn.capped": {
    ja: "ポケットが満杯だった分は持ち越せなかったよ。「あげる」「掃除する」で早めに使ってね",
    en: "Your pockets were already full, so a bit of this didn't carry over — spend some soon!",
    ru: "Карманы уже были полны, часть не поместилась — потратьте пораньше!",
  },

  // -- Home mini pet status (LINGO-031) --------------------------------------
  // LINGO-040: the home mini-pet row is gone (it duplicated the 育成 tab that
  // sat two centimetres below it). The neglect signal it carried survives as a
  // dot on the tab itself — same information, no screen space, no second
  // entry point to the same place.
  "tab.raise.attention": {
    ja: "お世話が必要です",
    en: "Needs looking after",
    ru: "Нужен уход",
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

/** Localized name of a language for use inside a sentence (e.g. "Russian").
 * `of` is a TargetLang: the language being NAMED can be one the app has no UI
 * for (Thai), while `lang` — the language doing the naming — must be a real UI
 * language. Every TargetLang has a `lang.name.*` key in all three catalogs. */
export function langName(lang: Lang, of: TargetLang): string {
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

  // LINGO-037: index.html ships `<html lang="ja">` and nothing ever updated it,
  // so every document stayed declared as Japanese no matter the UI language —
  // screen readers applied Japanese pronunciation to Russian and English text,
  // and browsers' "translate this page?" heuristics misfired. Not a visible
  // string, but the same rule one layer down: the document's declared language
  // must follow the UI language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

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
