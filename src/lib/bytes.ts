/**
 * 字节数的显示。
 *
 * 下载进度和图片压缩都要「1.4 MB」这种说法，而不是一串裸数字。放在一处是为了
 * 两边的小数位不会各写一套——同一个大小在两个地方显示成不同的样子，看着就像
 * 其中一个算错了。
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
