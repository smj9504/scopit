/**
 * Scopit - Analysis Progress Ring
 *
 * Live visualization of the packing-lead background analysis. Two encodings of
 * the same "how far along are we" job:
 *   - a radial meter (donut) for photo completion — magnitude toward a whole,
 *     the finest-grained signal the server exposes; and
 *   - a segmented strip below it, one segment per room, showing which room is
 *     being analyzed right now (done / analyzing / pending).
 *
 * Single-hue (brand primary) progress — not a categorical palette — so every
 * value is directly labeled and identity is never carried by color alone. The
 * shimmer on the in-progress room is disabled under prefers-reduced-motion.
 */
import React from 'react';
import { colors, fonts } from '@/styles/theme';

interface AnalysisProgressRingProps {
  totalRooms: number;
  completedRooms: number;
  totalPhotos: number;
  processedPhotos: number;
  currentRoom: string | null;
}

const RADIUS = 52;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnalysisProgressRing: React.FC<AnalysisProgressRingProps> = ({
  totalRooms,
  completedRooms,
  totalPhotos,
  processedPhotos,
  currentRoom,
}) => {
  const fraction = totalPhotos > 0 ? Math.min(processedPhotos / totalPhotos, 1) : 0;
  const percent = Math.round(fraction * 100);
  const dashOffset = CIRCUMFERENCE * (1 - fraction);

  // The room being analyzed right now is the first not-yet-completed one.
  const currentIndex = Math.min(completedRooms, totalRooms - 1);
  const roomNumber = Math.min(completedRooms + 1, totalRooms);

  const ariaLabel =
    `Analyzing your rooms: ${completedRooms} of ${totalRooms} rooms done, ` +
    `${processedPhotos} of ${totalPhotos} photos analyzed` +
    (currentRoom ? `, currently analyzing ${currentRoom}` : ', finishing up');

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <style>{`
        @keyframes scopitRingShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes scopitRingPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        .scopit-ring-current {
          background-image: linear-gradient(
            90deg,
            ${colors.primary} 0%,
            #6b7280 50%,
            ${colors.primary} 100%
          );
          background-size: 200% 100%;
          animation: scopitRingShimmer 1.4s linear infinite;
        }
        .scopit-ring-arc { animation: scopitRingPulse 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .scopit-ring-current { animation: none; background: ${colors.primary}; }
          .scopit-ring-arc { animation: none; }
        }
      `}</style>

      {/* Radial meter — photo completion */}
      <svg
        width={140}
        height={140}
        viewBox="0 0 120 120"
        aria-hidden="true"
        style={{ maxWidth: '100%' }}
      >
        <circle
          cx={60}
          cy={60}
          r={RADIUS}
          fill="none"
          stroke={colors.bgSunken}
          strokeWidth={STROKE}
        />
        <circle
          className="scopit-ring-arc"
          cx={60}
          cy={60}
          r={RADIUS}
          fill="none"
          stroke={colors.primary}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text
          x={60}
          y={58}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontFamily: fonts.heading,
            fontSize: 26,
            fontWeight: 800,
            fill: colors.textPrimary,
          }}
        >
          {percent}%
        </text>
        <text
          x={60}
          y={78}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontFamily: fonts.body, fontSize: 11, fill: colors.textMuted }}
        >
          analyzed
        </text>
      </svg>

      <p style={{ color: colors.textMuted, fontSize: 13, margin: '4px 0 16px' }}>
        {processedPhotos} of {totalPhotos} photos analyzed
      </p>

      {/* Segmented strip — one segment per room */}
      <div
        aria-hidden="true"
        style={{ display: 'flex', gap: 3, width: '100%', maxWidth: 320 }}
      >
        {Array.from({ length: totalRooms }).map((_, i) => {
          const done = i < completedRooms;
          const isCurrent = currentRoom !== null && i === currentIndex;
          return (
            <div
              key={i}
              className={isCurrent ? 'scopit-ring-current' : undefined}
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                background: done
                  ? colors.primary
                  : isCurrent
                    ? colors.primary
                    : colors.bgSunken,
              }}
            />
          );
        })}
      </div>

      <p style={{ color: colors.textSecondary, fontSize: 14, margin: '12px 0 0' }}>
        {currentRoom ? (
          <>
            Analyzing <strong style={{ color: colors.textPrimary }}>{currentRoom}</strong>
            {' '}— room {roomNumber} of {totalRooms}
          </>
        ) : (
          <>Wrapping up your estimate…</>
        )}
      </p>
    </div>
  );
};

export default AnalysisProgressRing;
