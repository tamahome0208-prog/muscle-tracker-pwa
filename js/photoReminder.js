// 体の進捗写真の撮影を促すリマインダー(js/homeTab.js)を出すべきかどうかの判定だけを
// 切り出したモジュール。DOM・store.js に依存しないので単体テストしやすい
// (js/backupReminder.js と同じ形)。
//
// 【なぜこの機能が要るか】
// settings.photoReminder は元から DEFAULTS に存在したが、**どこからも読まれていない
// 死んだ設定**だった。書いたまま繋いでいなかった。
//
// このユーザーの目標は細マッチョ = 見た目である。
// 体重や体脂肪率の数字は測定誤差に埋もれる — js/goals.js がまさにそう述べており、
// トレンドの表示に10週分の記録を要求している — のに対し、写真は3ヶ月で明確に変わる。
// **最も効く証拠が、撮り忘れで残らない。**
//
// このアプリには「毎回は出さない」という強いルールがある(通知が壁紙になる)。
// 閉じれば同じ期間だけ黙る。

import { isValidDateStr } from './workout.js';

/**
 * 撮影を促す間隔(日)。
 *
 * 【なぜ6週間か】毎週撮っても見た目はほぼ変わらず、撮る意味を感じなくなる。
 * 一方3ヶ月空けると、その間の変化を後から取り返せない。
 * js/goals.js が体組成のトレンドに8〜12週を要求していることとも整合する
 * (数字が動いたと言える頃には、写真も並べて見比べられる)。
 *
 * 【出典なし・実務上の仮定】この6週間という区切りを述べた文献は無い。
 * 上の2つの失敗(短すぎて飽きる/長すぎて取り返せない)の間を取った実務上の判断。
 */
export const PHOTO_INTERVAL_DAYS = 42;

function daysBetween(fromStr, toStr) {
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  return Math.round((to - from) / (24 * 3600 * 1000));
}

/**
 * lastPhotoDate: 最後に撮影した日('YYYY-MM-DD')。1枚も無ければ null。
 * startDate: 記録を始めた日(profile.startDate)。インストール直後に
 *            「まだ何も無いのに」と出さないための基準。
 * settings: store.get('settings')(photoReminder / photoReminderDismissedAt を見る)。
 * todayStr: 'YYYY-MM-DD'。
 *
 * 壊れた日付は「未設定」として扱う。lastPhotoDate が読めない場合は
 * 「撮っていない」方に倒す(撮り忘れを放置するより、出して閉じてもらう方がよい。
 * 閉じれば PHOTO_INTERVAL_DAYS だけ黙る)。
 */
export function shouldShowPhotoReminder(lastPhotoDate, startDate, settings, todayStr) {
  // settings が読めない状況でも既定(DEFAULTS では true)に倒す。
  // 明示的に false のときだけ出さない。
  if (settings && settings.photoReminder === false) return false;

  if (isValidDateStr(settings?.photoReminderDismissedAt)) {
    if (daysBetween(settings.photoReminderDismissedAt, todayStr) < PHOTO_INTERVAL_DAYS) return false;
  }

  if (isValidDateStr(lastPhotoDate)) {
    return daysBetween(lastPhotoDate, todayStr) >= PHOTO_INTERVAL_DAYS;
  }

  // 写真が1枚も無い場合は、記録を始めてから十分に経っていれば促す。
  // startDate が無いと「いつから数えるか」を決められないので出さない
  // (勝手に今日を起点にすると、インストール直後の利用者に即座に出てしまう)。
  if (!isValidDateStr(startDate)) return false;
  return daysBetween(startDate, todayStr) >= PHOTO_INTERVAL_DAYS;
}
