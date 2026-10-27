import { useRef, useState } from 'react';
import { PriorityTabs } from '../lib/priorityTabs';
import { useRafClassToggle, useStickySentinel } from '../lib/useStickySentinel';
import { PROFILE_TABS } from './PriorityTabsDemo';
import './PriorityTabsDemo.css';
import './StickyHeaderDemo.css';

export default function StickyHeaderDemo() {
  const [selected, setSelected] = useState('posts');
  // đếm số lần component render: cuộn lên xuống mà con số này không đổi
  const renders = useRef(0);
  renders.current++;

  const changes = useRef(0);
  const changesRef = useRef<HTMLElement>(null);
  const [barRef, setStuckClass] = useRafClassToggle<HTMLDivElement>('is-stuck');
  const sentinelRef = useStickySentinel((stuck) => {
    setStuckClass(stuck);
    changes.current++;
    // cập nhật DOM trực tiếp, không setState
    if (changesRef.current) changesRef.current.textContent = `${changes.current} (${stuck ? 'đang dính' : 'không dính'})`;
  });

  return (
    <div className='sh-page'>
      <div className='sh-cover' aria-hidden />
      <div className='sh-profile'>
        <div className='sh-avatar' aria-hidden />
        <div>
          <h1>Nguyễn Văn A</h1>
          <p className='hint'>
            Cuộn xuống: khi thanh tab chạm mép trên, nó trượt sang dạng gọn (avatar + tên). Không nghe
            sự kiện scroll, không re-render React.
          </p>
          <div className='stats'>
            <div className='stat'>
              <b>{renders.current}</b>
              <span>lần render: cuộn thoải mái, số này đứng yên</span>
            </div>
            <div className='stat'>
              <b ref={changesRef}>0</b>
              <span>lần đổi trạng thái sticky</span>
            </div>
          </div>
        </div>
      </div>

      {/* sentinel cao 0, ngay trước thanh sticky */}
      <div ref={sentinelRef} aria-hidden />
      <div ref={barRef} className='sh-bar'>
        <div className='sh-viewport'>
          <div className='sh-container'>
            <div className='sh-primary'>
              <PriorityTabs tabs={PROFILE_TABS} selectedKey={selected} onSelect={setSelected} height={52} />
            </div>
            <div className='sh-sticky-row'>
              <button
                className='sh-mini'
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                aria-label='Lên đầu trang cá nhân'
              >
                <span className='sh-avatar sh-avatar-sm' aria-hidden />
                <b>Nguyễn Văn A</b>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className='sh-feed'>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className='card'>
            <b>Bài viết #{i + 1}</b>
            <div className='skeleton' style={{ width: '80%' }} />
            <div className='skeleton' style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
