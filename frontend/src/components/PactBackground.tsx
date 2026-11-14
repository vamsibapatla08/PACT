type Props = { authenticated?: boolean }

/** The landing page's real ambient finance language, shared without its coin. */
export function PactBackground({ authenticated = false }: Props) {
  return (
    <div className={`pact-background${authenticated ? ' pact-background-auth' : ''}`} aria-hidden="true">
      <div className="grain" />
      <div className="top-glow" />
      <div className="global-finance-bg">
        <div className="global-orbit orbit-wide" />
        <div className="global-orbit orbit-tall" />
        <div className="bg-medallion medallion-split">÷</div>
        <div className="bg-medallion medallion-value">$</div>
        <div className="bg-medallion medallion-check">✓</div>
        <div className="ledger-ticks"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <svg className="global-route" viewBox="0 0 1440 900" preserveAspectRatio="none">
          <path d="M-80 660 C190 520 365 780 610 625 S1010 450 1510 650" />
          <path d="M210 -40 C390 170 590 56 770 220 S1120 420 1490 240" />
        </svg>
        <div className="ambient-particles"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="market-panel">
          <div className="market-label"><span /> MARKET MOTION <small>VISUAL</small></div>
          <div className="candlesticks"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        </div>
        <div className="allocation-wheel"><span>4</span><small>SHARED<br />PARTS</small></div>
        <div className="payment-card-shape"><span className="card-chip" /><b>PACT</b><i>•••• 2026</i></div>
        <div className="value-stack"><i /><i /><i /><i /><span>VALUE</span></div>
        <svg className="market-curve" viewBox="0 0 320 120" preserveAspectRatio="none">
          <defs><linearGradient id="marketFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dcb866" stopOpacity=".18"/><stop offset="1" stopColor="#dcb866" stopOpacity="0"/></linearGradient></defs>
          <path className="market-area" d="M0 108 C35 98 52 70 82 78 S132 96 159 55 S212 74 238 41 S278 48 320 12 L320 120 L0 120 Z" />
          <path className="market-line" d="M0 108 C35 98 52 70 82 78 S132 96 159 55 S212 74 238 41 S278 48 320 12" />
        </svg>
      </div>
      <div className="left-finance-field">
        <div className="finance-token token-dollar"><span>$</span></div>
        <div className="finance-token token-verified"><span>✓</span></div>
        <div className="ledger-card">
          <div className="ledger-label"><span /> PACT / VALUE FLOW</div>
          <div className="ledger-bars"><i /><i /><i /><i /><i /></div>
          <small>SPLIT&nbsp;&nbsp;·&nbsp;&nbsp;APPROVE&nbsp;&nbsp;·&nbsp;&nbsp;SETTLE</small>
        </div>
        <svg className="transfer-map" viewBox="0 0 620 520" preserveAspectRatio="none">
          <path d="M18 92 C152 28 216 182 338 116 S496 44 602 102" />
          <path d="M6 406 C132 342 213 468 329 366 S498 282 618 348" />
          <circle className="transfer-node node-one" r="4" cx="18" cy="92" />
          <circle className="transfer-node node-two" r="4" cx="6" cy="406" />
        </svg>
      </div>
    </div>
  )
}
