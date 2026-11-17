import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useActiveElement } from '@/hooks/useActiveElement';
import { KEYBOARD_ENTER_GLOW } from '@/lib/enterGlow';
import type { NextStep } from '@/lib/nextSteps';

function NextStepLink({
  step,
  className,
  glow,
}: {
  step: NextStep;
  className: string;
  glow: boolean;
}) {
  const id = useId();
  const active = useActiveElement();
  return (
    <Link
      id={id}
      to={step.to}
      state={step.state}
      className={`${className} ${glow && active?.id === id ? KEYBOARD_ENTER_GLOW : ''}`}
    >
      {step.label}
    </Link>
  );
}

/**
 * Today's next steps once something ends (#118), each a link, in the
 * order given; nothing when there are none. With `glow`, the one with
 * focus shows that Enter would open it (#94).
 */
export function NextSteps({
  steps,
  className,
  linkClassName,
  glow = false,
}: {
  steps: NextStep[];
  className: string;
  linkClassName: string;
  glow?: boolean;
}) {
  if (steps.length === 0) return null;
  return (
    <ul aria-label="Next steps" className={className}>
      {steps.map((step) => (
        <li key={step.to}>
          <NextStepLink step={step} className={linkClassName} glow={glow} />
        </li>
      ))}
    </ul>
  );
}
