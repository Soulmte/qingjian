/**
 * 列表里的时间戳。
 *
 * 历史版本列表里同时出现「十分钟前改的」和「去年改的」是常态，全都写成完整日期
 * 会把列表挤得看不清重点，所以按远近分三档：今天只写时刻，今年写月日，更早才带
 * 年份。
 *
 * 用绝对时间而不是「3 分钟前」：相对的写法会随时间变旧，而这个列表不会自己刷新，
 * 隔一会儿看就变成假话。
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** `seconds` 是 Unix 秒；认不出来时返回空串。 */
export function formatRevisionTime(seconds: number, now: Date = new Date()): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return "";

  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return clock;

  const monthDay = `${at.getMonth() + 1}月${at.getDate()}日`;
  if (at.getFullYear() === now.getFullYear()) return `${monthDay} ${clock}`;

  return `${at.getFullYear()}年${monthDay}`;
}
