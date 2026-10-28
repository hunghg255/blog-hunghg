/** Dữ liệu nhỏ cho demo tìm emoji: [emoji, nhóm, tên tiếng Anh…, tên tiếng Việt…]. Tự soạn, không lấy từ WhatsApp. */
type Row = [emoji: string, category: string, en: string[], vi: string[]];

const ROWS: Row[] = [
  ['😀', 'SMILEYS_PEOPLE', ['grinning face', 'smile'], ['cười toe']],
  ['😁', 'SMILEYS_PEOPLE', ['beaming face'], ['cười tít mắt']],
  ['😂', 'SMILEYS_PEOPLE', ['joy', 'laugh tears'], ['cười ra nước mắt']],
  ['🤣', 'SMILEYS_PEOPLE', ['rolling on the floor', 'laughing hard'], ['cười lăn lộn']],
  ['😊', 'SMILEYS_PEOPLE', ['smiling eyes', 'blush'], ['cười mỉm', 'ngượng']],
  ['😍', 'SMILEYS_PEOPLE', ['heart eyes'], ['mắt trái tim']],
  ['😘', 'SMILEYS_PEOPLE', ['kiss', 'kissing heart'], ['hôn gió']],
  ['😛', 'SMILEYS_PEOPLE', ['tongue'], ['lè lưỡi']],
  ['🤔', 'SMILEYS_PEOPLE', ['thinking'], ['suy nghĩ']],
  ['😭', 'SMILEYS_PEOPLE', ['loudly crying', 'sob'], ['khóc to']],
  ['😢', 'SMILEYS_PEOPLE', ['crying face', 'sad tear'], ['khóc', 'buồn rơi lệ']],
  ['😡', 'SMILEYS_PEOPLE', ['pouting', 'angry'], ['giận dữ']],
  ['😱', 'SMILEYS_PEOPLE', ['scream'], ['hét lên']],
  ['😴', 'SMILEYS_PEOPLE', ['sleeping'], ['ngủ']],
  ['🙂', 'SMILEYS_PEOPLE', ['slightly smiling'], ['cười nhẹ']],
  ['🙃', 'SMILEYS_PEOPLE', ['upside down'], ['lộn ngược']],
  ['😉', 'SMILEYS_PEOPLE', ['wink'], ['nháy mắt']],
  ['😎', 'SMILEYS_PEOPLE', ['sunglasses', 'cool'], ['kính râm', 'ngầu']],
  ['🤗', 'SMILEYS_PEOPLE', ['hug'], ['ôm']],
  ['👍', 'SMILEYS_PEOPLE', ['thumbs up', 'like'], ['thích', 'đồng ý']],
  ['👎', 'SMILEYS_PEOPLE', ['thumbs down'], ['không thích']],
  ['👏', 'SMILEYS_PEOPLE', ['clap'], ['vỗ tay']],
  ['🙏', 'SMILEYS_PEOPLE', ['pray', 'thanks'], ['cảm ơn', 'cầu nguyện']],
  ['💪', 'SMILEYS_PEOPLE', ['muscle', 'strong'], ['cơ bắp', 'mạnh mẽ']],
  ['👋', 'SMILEYS_PEOPLE', ['wave', 'hello'], ['vẫy tay', 'xin chào']],
  ['🐱', 'ANIMALS_NATURE', ['cat face'], ['mèo']],
  ['😺', 'SMILEYS_PEOPLE', ['smiling cat'], ['mèo cười']],
  ['😿', 'SMILEYS_PEOPLE', ['crying cat'], ['mèo khóc']],
  ['🐈', 'ANIMALS_NATURE', ['cat'], ['con mèo']],
  ['🐶', 'ANIMALS_NATURE', ['dog face'], ['chó']],
  ['🐕', 'ANIMALS_NATURE', ['dog'], ['con chó']],
  ['🐟', 'ANIMALS_NATURE', ['fish'], ['cá']],
  ['🐉', 'ANIMALS_NATURE', ['dragon'], ['rồng']],
  ['🌹', 'ANIMALS_NATURE', ['rose'], ['hoa hồng']],
  ['🌸', 'ANIMALS_NATURE', ['cherry blossom'], ['hoa anh đào', 'hoa đào']],
  ['🌻', 'ANIMALS_NATURE', ['sunflower'], ['hoa hướng dương']],
  ['🌧️', 'ANIMALS_NATURE', ['rain cloud'], ['mưa']],
  ['☀️', 'ANIMALS_NATURE', ['sun'], ['mặt trời', 'nắng']],
  ['🍜', 'FOOD_DRINK', ['noodles', 'ramen'], ['phở', 'bún', 'mì']],
  ['🍚', 'FOOD_DRINK', ['rice'], ['cơm']],
  ['🥖', 'FOOD_DRINK', ['baguette'], ['bánh mì']],
  ['☕', 'FOOD_DRINK', ['coffee'], ['cà phê']],
  ['🧋', 'FOOD_DRINK', ['bubble tea'], ['trà sữa']],
  ['🍺', 'FOOD_DRINK', ['beer'], ['bia']],
  ['🎂', 'FOOD_DRINK', ['birthday cake', 'cake'], ['bánh sinh nhật']],
  ['🍕', 'FOOD_DRINK', ['pizza'], ['pizza']],
  ['🥭', 'FOOD_DRINK', ['mango'], ['xoài']],
  ['⚽', 'ACTIVITY', ['soccer', 'football'], ['bóng đá']],
  ['🏸', 'ACTIVITY', ['badminton'], ['cầu lông']],
  ['🎉', 'ACTIVITY', ['party popper', 'celebrate'], ['chúc mừng', 'tiệc']],
  ['🎁', 'ACTIVITY', ['gift', 'present'], ['quà']],
  ['🎮', 'ACTIVITY', ['video game'], ['chơi game']],
  ['🏍️', 'TRAVEL_PLACES', ['motorcycle'], ['xe máy']],
  ['✈️', 'TRAVEL_PLACES', ['airplane'], ['máy bay']],
  ['🏖️', 'TRAVEL_PLACES', ['beach'], ['bãi biển', 'biển']],
  ['🏠', 'TRAVEL_PLACES', ['house', 'home'], ['nhà']],
  ['📱', 'OBJECTS', ['mobile phone'], ['điện thoại']],
  ['💻', 'OBJECTS', ['laptop'], ['máy tính']],
  ['💡', 'OBJECTS', ['light bulb', 'idea'], ['ý tưởng', 'bóng đèn']],
  ['💰', 'OBJECTS', ['money bag'], ['tiền']],
  ['❤️', 'SYMBOLS', ['red heart', 'love'], ['tim', 'yêu']],
  ['💕', 'SYMBOLS', ['two hearts'], ['hai trái tim']],
  ['💔', 'SYMBOLS', ['broken heart'], ['tim vỡ', 'thất tình']],
  ['✅', 'SYMBOLS', ['check mark'], ['xong', 'đúng']],
  ['❌', 'SYMBOLS', ['cross mark'], ['sai']],
  ['🔥', 'SYMBOLS', ['fire', 'lit'], ['lửa', 'cháy']],
  ['🇻🇳', 'FLAGS', ['flag vietnam'], ['cờ việt nam']],
  ['🇯🇵', 'FLAGS', ['flag japan'], ['cờ nhật bản']],
];

/** Từ điển tiếng Anh và tiếng Việt: từ khoá → emoji (dict sau ghi đè dict trước nếu trùng khoá). */
export const EN_DICT: Record<string, string> = {};
export const VI_DICT: Record<string, string> = {};
/** emoji → thứ tự trong bảng chọn (nhóm trước, emoji trong nhóm sau). */
export const CATEGORY_ORDER = new Map<string, number>();

const CATEGORIES = ['SMILEYS_PEOPLE', 'ANIMALS_NATURE', 'FOOD_DRINK', 'ACTIVITY', 'TRAVEL_PLACES', 'OBJECTS', 'SYMBOLS', 'FLAGS'];
for (const cat of CATEGORIES) {
  for (const [emoji, c, en, vi] of ROWS) {
    if (c !== cat) continue;
    CATEGORY_ORDER.set(emoji, CATEGORY_ORDER.size);
    for (const k of en) EN_DICT[k] = emoji;
    for (const k of vi) VI_DICT[k] = emoji;
  }
}

/** Danh sách "phổ biến" cố định (bản gốc có 50 emoji, ở đây rút gọn). */
export const POPULAR = ['😂', '😍', '😘', '🤣', '😀', '❤️', '😉', '😊', '🤔', '😭', '😁', '👏', '😎', '👍', '🙏', '🎂', '🌹'];
