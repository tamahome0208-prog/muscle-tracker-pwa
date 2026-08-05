// バックアップ(JSONエクスポート)を促すリマインダー(js/homeTab.js)を出すべきかどうかの
// 判定だけを切り出したモジュール。DOM・store.js に依存しないので単体テストしやすい。
//
// このアプリには「毎回は出さない」という強いルールがある(通知が壁紙になる)。
// そのため、しきい値は2つに分けている:
//  1. そもそも失うと惜しいだけのデータ量になっているか(MEANINGFUL_RECORD_COUNT)
//  2. 最近バックアップした/最近このリマインダーを閉じたばかりではないか(REMINDER_INTERVAL_DAYS)

import { isValidDateStr } from './workout.js';

// 「失うと惜しい量のデータ」のしきい値。このユーザーは週3回ジム+1日2〜3食を記録する。
// 15件は、その使い方なら3〜4日ほどで自然に超える量であり、インストール初日にいきなり
// 「まだ何も無いのに」と出てしまうことは避けつつ、1週間分をまるごと失う前には出るようにする。
export const MEANINGFUL_RECORD_COUNT = 15;

// 「最近エクスポートした」とみなす期間、および一度閉じたリマインダーを再び黙らせておく
// 期間。どちらも同じ14日にして「だいたい2週間に一度、思い出させる」という一貫したリズムに
// する。データ喪失のリスクを長期間放置しないことと、毎回出して壁紙にしないことの折衷。
export const REMINDER_INTERVAL_DAYS = 14;

function daysBetween(fromStr, toStr) {
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  return Math.round((to - from) / (24 * 3600 * 1000));
}

/**
 * recordCount: workouts+meals+body+badminton の合計件数(写真はIndexedDBの非同期問い合わせが
 * 必要なため、同期的に判定したいこの関数の対象には含めない)。
 * settings: store.get('settings') の中身(lastExportDate/backupReminderDismissedAt を見る)。
 * todayStr: 'YYYY-MM-DD'。
 *
 * lastExportDate/backupReminderDismissedAt が壊れている(手編集・古いインポート等で
 * 日付として読めない)場合は、それぞれ「未設定」として扱う(=念のため出す方向に倒す。
 * ただしそれも閉じれば14日は黙る)。
 */
export function shouldShowBackupReminder(recordCount, settings, todayStr) {
  if (recordCount < MEANINGFUL_RECORD_COUNT) return false;

  if (isValidDateStr(settings?.backupReminderDismissedAt)) {
    if (daysBetween(settings.backupReminderDismissedAt, todayStr) < REMINDER_INTERVAL_DAYS) return false;
  }

  if (!isValidDateStr(settings?.lastExportDate)) return true;
  return daysBetween(settings.lastExportDate, todayStr) >= REMINDER_INTERVAL_DAYS;
}
