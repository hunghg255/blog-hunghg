import { useState } from 'react';
import { PriorityTabs } from '../lib/priorityTabs';
import './PriorityTabsDemo.css';

export const PROFILE_TABS = [
  { key: 'posts', label: 'Bài viết' },
  { key: 'about', label: 'Giới thiệu' },
  { key: 'friends', label: 'Bạn bè' },
  { key: 'photos', label: 'Ảnh' },
  { key: 'videos', label: 'Video' },
  { key: 'checkins', label: 'Check-in' },
  { key: 'music', label: 'Âm nhạc' },
  { key: 'events', label: 'Sự kiện' },
];

export default function PriorityTabsDemo() {
  const [width, setWidth] = useState(560);
  const [selected, setSelected] = useState('posts');
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);

  return (
    <div className='page'>
      <h1>Tab "Xem thêm" không cần đo bằng JS</h1>
      <p className='hint'>
        Kéo thanh trượt (hoặc kéo góc phải dưới khung) để đổi độ rộng. Tab không vừa tự vào menu
        "Xem thêm". Chọn một tab trong menu: nút "Xem thêm" được tô như tab đang chọn. Focus vào
        tab rồi dùng phím ← → Home End, ↓ trên "Xem thêm" để mở menu.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          Độ rộng
          <input
            type='range'
            min={200}
            max={860}
            value={width}
            aria-label='Độ rộng khung tab'
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <code>{width}px</code>
        </label>
      </div>
      <div className='pt-frame' style={{ width }}>
        <PriorityTabs tabs={PROFILE_TABS} selectedKey={selected} onSelect={setSelected} onHiddenChange={setHiddenKeys} />
      </div>
      <div className='stats' style={{ marginTop: 12 }}>
        <div className='stat'>
          <b>{PROFILE_TABS.find((t) => t.key === selected)?.label}</b>
          <span>tab đang chọn</span>
        </div>
        <div className='stat'>
          <b>{hiddenKeys.length}</b>
          <span>tab trong "Xem thêm": {hiddenKeys.join(', ') || '—'}</span>
        </div>
      </div>
    </div>
  );
}
