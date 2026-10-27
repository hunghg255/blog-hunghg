// Component "nặng", được tách thành chunk riêng bằng dynamic import().
export default function ProfileDialog({ name, bio }: { name: string; bio: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #ffb347, #f2466b)',
          flexShrink: 0,
        }}
      />
      <div>
        <h2>{name}</h2>
        <p className='muted' style={{ margin: 0 }}>
          {bio}
        </p>
      </div>
    </div>
  );
}
