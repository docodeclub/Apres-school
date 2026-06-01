import { labApiContracts, labDataEntities, labIntegrations, labRlsPolicies, labRoleAccessMatrix } from "./labData.js";

export default function DataModelLab({ onExport }) {
  return (
    <section className="lab-data-model">
      <div className="lab-data-hero">
        <div>
          <p className="eyebrow">Build blueprint</p>
          <h2>The real system underneath the prototype.</h2>
          <p>This is the implementation map: data entities, relationships, integrations and audit responsibilities needed to turn the lab into production software.</p>
        </div>
        <button className="button book" type="button" onClick={onExport}>Export Schema Notes</button>
      </div>
      <div className="lab-entity-grid">
        {labDataEntities.map(([name, description, relations]) => (
          <article key={name}>
            <strong>{name}</strong>
            <p>{description}</p>
            <small>Related: {relations}</small>
          </article>
        ))}
      </div>
      <section className="lab-relationship-map">
        <div>
          <p className="eyebrow">Relationship flow</p>
          <h2>From parent profile to register and finance.</h2>
        </div>
        <div className="lab-flow-map">
          {["families", "children", "bookings", "payments", "sessions", "register_entries", "messages", "audit_events"].flatMap((item, index, items) => (
            index < items.length - 1
              ? [<span key={item}>{item}</span>, <em key={`${item}-arrow`}>→</em>]
              : [<span key={item}>{item}</span>]
          ))}
        </div>
      </section>
      <section className="lab-integration-grid">
        <div>
          <p className="eyebrow">Integrations</p>
          <h2>External systems this would need.</h2>
        </div>
        <div>
          {labIntegrations.map(([name, description]) => (
            <article key={name}>
              <strong>{name}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-access-blueprint">
        <div>
          <p className="eyebrow">Access control</p>
          <h2>Role permissions mapped to real data boundaries.</h2>
          <p>The lab UI now has role views; this is the production guardrail it would need behind the scenes.</p>
        </div>
        <div className="lab-access-matrix">
          {labRoleAccessMatrix.map(([role, data, actions]) => (
            <article key={role}>
              <span>{role}</span>
              <strong>{data}</strong>
              <p>{actions}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-api-contracts">
        <div>
          <p className="eyebrow">API contracts</p>
          <h2>Backend endpoints the hybrid system should expose.</h2>
        </div>
        <div className="lab-api-table">
          {labApiContracts.map(([method, path, role, purpose]) => (
            <article key={`${method}-${path}`}>
              <span>{method}</span>
              <strong>{path}</strong>
              <em>{role}</em>
              <p>{purpose}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-rls-policies">
        <div>
          <p className="eyebrow">Row-level security</p>
          <h2>Policy sketch before database build.</h2>
        </div>
        <div>
          {labRlsPolicies.map(([table, policy]) => (
            <article key={table}>
              <strong>{table}</strong>
              <p>{policy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lab-audit-model">
        <div>
          <p className="eyebrow">Audit model</p>
          <h2>Events worth recording.</h2>
        </div>
        <div>
          {[
            "Booking created, amended, cancelled or waitlisted",
            "Payment marked paid, pending, refunded or reconciled",
            "Register check-in, check-out, absence, incident or late collection",
            "Rules changed or admin override applied",
            "Family, child, consent or medical plan changed",
            "Message generated or sent",
          ].map((event) => <span key={event}>{event}</span>)}
        </div>
      </section>
    </section>
  );
}
