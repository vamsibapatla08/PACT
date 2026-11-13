import { motion } from 'motion/react'

export function BrandHeader() {
  return (
    <motion.header
      className="brand-header"
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="nav-identity">
        <a className="brand-lockup" href="/" aria-label="PACT home">
          <img src="/pact-logo.png" alt="" />
          <span>PACT</span>
        </a>
        <span className="brand-descriptor">Group planning / Financial coordination</span>
      </div>
      <div className="trust-mark"><span /> Secure access</div>
    </motion.header>
  )
}
