import { useEffect, useRef, useState } from 'react';
import { Card, Skeleton, Typography } from 'antd';

const { Text } = Typography;

function useAnimatedNumber(target, loading) {
  const [displayValue, setDisplayValue] = useState(target);
  const previousValueRef = useRef(target);

  useEffect(() => {
    if (loading) return undefined;

    const startValue = previousValueRef.current;
    const endValue = Number(target) || 0;

    if (startValue === endValue) {
      setDisplayValue(endValue);
      return undefined;
    }

    let frameId;
    let startTime;
    const duration = 520;

    const tick = (timestamp) => {
      if (startTime == null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      const nextValue = Math.round(startValue + (endValue - startValue) * eased);

      setDisplayValue(nextValue);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        previousValueRef.current = endValue;
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [target, loading]);

  useEffect(() => {
    if (loading) {
      setDisplayValue(target);
      previousValueRef.current = target;
    }
  }, [loading, target]);

  return displayValue;
}

export default function StatCard({ title, value, icon, color, loading, helper, secondaryLabel, secondaryValue, tone = 'default' }) {
  const animatedValue = useAnimatedNumber(value, loading);
  const animatedSecondaryValue = useAnimatedNumber(secondaryValue, loading);

  return (
    <Card
      variant="borderless"
      className={`dashboard-stat-card dashboard-stat-card--${tone}`}
      style={{
        '--stat-accent': color,
        height: '100%',
      }}
    >
      <Skeleton loading={loading} active paragraph={false}>
        <div className="dashboard-stat-card__head">
          <span className="dashboard-stat-card__title">{title}</span>
          <span className="dashboard-stat-card__icon">
            {icon}
          </span>
        </div>

        <div className="dashboard-stat-card__body">
          <div>
            <div className="dashboard-stat-card__value" style={{ color }}>
              {animatedValue}
            </div>
            {helper ? <Text className="dashboard-stat-card__helper">{helper}</Text> : null}
          </div>

          {secondaryLabel ? (
            <div className="dashboard-stat-card__secondary">
              <Text className="dashboard-stat-card__secondary-label">{secondaryLabel}</Text>
              <div className="dashboard-stat-card__secondary-value">{animatedSecondaryValue}</div>
            </div>
          ) : null}
        </div>
      </Skeleton>
    </Card>
  );
}
