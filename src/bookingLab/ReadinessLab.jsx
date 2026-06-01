import { readinessItems, readinessPhases, readinessRisks } from "./labData.js";

export default function ReadinessLab({ onExport }) {
  return (
    <section className="lab-readiness">
      <div className="lab-readiness-hero">
        <div>
          <p className="eyebrow">Production readiness</p>
          <h2>What has to be true before this becomes real software.</h2>
          <p>The lab proves the shape of the product. This view separates product confidence from deployment readiness.</p>
        </div>
        <button className="button book" type="button" onClick={onExport}>Export Readiness Plan</button>
      </div>
      <section className="lab-readiness-grid">
        {readinessItems.map(([area, current, needed]) => (
          <article key={area}>
            <strong>{area}</strong>
            <span>Current</span>
            <p>{current}</p>
            <span>Needed</span>
            <p>{needed}</p>
          </article>
        ))}
      </section>
      <section className="lab-risk-register">
        <div>
          <p className="eyebrow">Risk register</p>
          <h2>Risks to solve before pilot.</h2>
        </div>
        <div>
          {readinessRisks.map(([level, risk, mitigation]) => (
            <article key={risk}>
              <span>{level}</span>
              <strong>{risk}</strong>
              <p>{mitigation}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-phase-plan">
        <div>
          <p className="eyebrow">Build phases</p>
          <h2>A sensible route from lab to pilot.</h2>
        </div>
        <div>
          {readinessPhases.map(([phase, title, detail]) => (
            <article key={phase}>
              <strong>{phase}</strong>
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-gonogo">
        <div>
          <p className="eyebrow">Go / no-go</p>
          <h2>Pilot checklist</h2>
        </div>
        <div>
          {[
            "Parent/staff/admin permissions tested end to end.",
            "Card and voucher/TFC reconciliation tested.",
            "Medical, collector and incident data access reviewed.",
            "Reports match expected register and finance totals.",
            "One-site pilot content, comms and support process approved.",
            "Rollback plan agreed before parent launch.",
          ].map((item) => <label key={item}><input type="checkbox" />{item}</label>)}
        </div>
      </section>
    </section>
  );
}
