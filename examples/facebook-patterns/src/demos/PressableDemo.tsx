import { useState } from 'react';
import type { InteractionState } from '../lib/pressable';
import { Pressable, PressableOverlay } from '../lib/pressableComponent';
import { Log, useLog } from './shared';
import './PressableDemo.css';

function StateBadges({ state }: { state: InteractionState }) {
  return (
    <span className='pr-badges'>
      {(['hovered', 'pressed', 'focused', 'focusVisible'] as const).map((k) => (
        <span key={k} className={`pr-badge${state[k] ? ' on' : ''}`}>
          {k}
        </span>
      ))}
    </span>
  );
}

export default function PressableDemo() {
  const { lines, add } = useLog();
  const [likes, setLikes] = useState(0);
  const [cardOpens, setCardOpens] = useState(0);

  return (
    <div className='page'>
      <h1>Pressable: hover, press, focus-visible</h1>
      <p className='hint'>
        Nhấn giữ nút rồi kéo chuột ra ngoài: trạng thái pressed tắt, nhả ra ngoài thì không có
        onPress. Bấm chuột thì không có vòng focus; bấm Tab thì có. Ctrl/Cmd + click vào link để
        trình duyệt tự mở tab mới.
      </p>

      <div className='pr-grid'>
        <Pressable
          role='button'
          className='pr-btn'
          onPress={() => add('onPress: Đăng bài', 'ok')}
          onPressStart={(e) => add(`pressstart (${e.pointerType})`, 'muted')}
          onPressEnd={(e) => add(`pressend${e.cancelled ? ' — huỷ (con trỏ đã ra ngoài)' : ''}`, e.cancelled ? 'warn' : 'muted')}
        >
          {(s) => (
            <>
              <PressableOverlay state={s} />
              <span className='pr-label'>Đăng bài</span>
              <StateBadges state={s} />
            </>
          )}
        </Pressable>

        <Pressable
          role='link'
          link={{ url: '#/pressable' }}
          className='pr-btn pr-link'
          onPress={(e) => {
            const modified = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
            add(
              modified
                ? 'onPress + phím bổ trợ: KHÔNG preventDefault, trình duyệt tự mở tab/cửa sổ mới'
                : 'onPress: điều hướng nội bộ (preventDefault, không tải lại trang)',
              modified ? 'warn' : 'ok',
            );
          }}
        >
          {(s) => (
            <>
              <PressableOverlay state={s} />
              <span className='pr-label'>Link tới trang cá nhân</span>
              <StateBadges state={s} />
            </>
          )}
        </Pressable>

        {/* Link thường, KHÔNG có onPress: Pressable không preventDefault, trình duyệt tự mở link */}
        <Pressable
          role='link'
          link={{ url: 'https://developer.mozilla.org/docs/Web/API/Pointer_events', target: '_blank', rel: 'noopener' }}
          className='pr-btn pr-plain-link'
        >
          {(s) => (
            <>
              <PressableOverlay state={s} />
              <span className='pr-label'>Link thường (không onPress) ↗</span>
              <StateBadges state={s} />
            </>
          )}
        </Pressable>

        <Pressable role='button' className='pr-btn' disabled onPress={() => add('không bao giờ chạy', 'err')}>
          {(s) => (
            <>
              <span className='pr-label'>Nút disabled</span>
              <StateBadges state={s} />
            </>
          )}
        </Pressable>
      </div>

      <h3 className='pr-h'>Pressable lồng nhau</h3>
      <Pressable
        role='article'
        className='pr-card'
        onPress={() => {
          setCardOpens((n) => n + 1);
          add('onPress: mở bài viết (card)', 'ok');
        }}
      >
        {(s) => (
          <>
            <PressableOverlay state={s} />
            <b>Bài viết của Nguyễn Văn A</b>
            <p className='muted' style={{ margin: '4px 0 10px' }}>
              Bấm vào card để mở bài, bấm "Thích" thì chỉ thích, không mở bài.
            </p>
            <Pressable
              role='button'
              className='pr-like'
              label='Thích'
              onPress={() => {
                setLikes((n) => n + 1);
                add('onPress: Thích (card KHÔNG nhận)', 'ok');
              }}
            >
              {(inner) => (
                <>
                  <PressableOverlay state={inner} offset={4} />👍 Thích · {likes}
                </>
              )}
            </Pressable>
            <span className='muted' style={{ marginLeft: 12, fontSize: 13 }}>
              mở bài: {cardOpens} lần
            </span>
          </>
        )}
      </Pressable>

      <h3 className='pr-h'>Log</h3>
      <Log lines={lines} />
    </div>
  );
}
