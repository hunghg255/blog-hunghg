/**
 * Mô phỏng cách pmDiff của Postman chia khối khi so ba bản theo SỐ THỨ TỰ DÒNG
 * (threeWaylineDiff + collectConflict + collectDiff). Viết lại để so sánh trong demo,
 * không phải mã gốc: chỉ giữ phần chia khối, bỏ phần dựng diff hiển thị.
 */

export interface IndexBlock {
  /** khối xung đột (dòng thứ i của "của tôi" khác dòng thứ i của "của họ") */
  conflict: boolean;
  from: number;
  to: number;
}

export function indexLineMerge(base: string, ours: string, theirs: string) {
  const o = base.split('\n');
  const a = ours.split('\n');
  const b = theirs.split('\n');
  const max = Math.max(o.length, a.length, b.length);
  const blocks: IndexBlock[] = [];
  let conflicts = 0;
  let index = 0;

  while (index < max) {
    if (a[index] !== b[index]) {
      // collectConflict: đi tiếp chừng nào hai bên còn khác nhau ở cùng số dòng
      let end = index;
      while (end < max && a[end] !== b[end]) end++;
      // chạm cuối một bản thì coi như xung đột tới hết
      if (end === o.length || end === a.length || end === b.length) end = max;
      blocks.push({ conflict: true, from: index, to: Math.max(end, index + 1) });
      conflicts++;
      index = Math.max(end, index + 1);
    } else if (o[index] !== a[index]) {
      // hai bên sửa giống nhau
      let end = index;
      while (end < max && o[end] !== a[end] && (a[end] === b[end] || b[end] === o[end])) end++;
      blocks.push({ conflict: false, from: index, to: Math.max(end, index + 1) });
      index = Math.max(end, index + 1);
    } else {
      index++;
    }
  }

  return { blocks, conflicts };
}
