// Honest transaction-safety statement. Today this app is READ-ONLY — connecting
// a wallet never signs a transaction or moves funds. This panel states the
// safety principles that will govern any future on-chain action, so the promise
// is visible up front. Nothing here claims a feature is live.
export default function TxSafetyNote() {
  const points = [
    ["Read-only today", "Connecting shows balances only — no transaction is ever signed right now."],
    ["Full disclosure", "When features go live, every transaction will show the Network, Program, Token, Amount, and estimated fee before you approve."],
    ["You are always in control", "Nothing is ever auto-signed. All signing happens in your own wallet, and you can reject any request."],
    ["No secrets, ever", "This site never asks for or stores your seed phrase or private keys. It cannot move your funds."],
  ];
  return (
    <div className="panel txsafe">
      <div className="panel-head">
        <h3 style={{ margin: 0 }}>🛡️ Transaction Safety</h3>
      </div>
      <ul className="txsafe-list">
        {points.map(([title, body]) => (
          <li key={title}>
            <strong>{title}.</strong> {body}
          </li>
        ))}
      </ul>
    </div>
  );
}
