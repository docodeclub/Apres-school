import { useEffect, useRef } from "react";
import { resolveHolidayCampInfo, trackHolidayCampInfoOpened } from "./holidayCampInfo.js";

export default function HolidayCampInfoDrawer({ camp, open, onClose }) {
  const drawerRef = useRef(null);
  const closeRef = useRef(null);
  const content = resolveHolidayCampInfo(camp || {});

  useEffect(() => {
    if (!open) return undefined;
    trackHolidayCampInfoOpened(camp);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, camp, onClose]);

  if (!open || !camp) return null;
  const jumpTo = (section) => drawerRef.current?.querySelector(`[data-camp-info-section="${section}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="lab-camp-info-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="lab-camp-info-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="camp-info-title">
        <header>
          <div>
            <p className="eyebrow">More Info</p>
            <h2 id="camp-info-title">{content.title}</h2>
            <span>{camp.site || "Après School"} · {camp.period || camp.title || "Holiday Camp"}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close camp information">×</button>
        </header>
        <div className="lab-camp-info-body">
          <div className="lab-camp-info-intro">{content.description.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
          <nav aria-label="Camp information sections">
            <button type="button" onClick={() => jumpTo("typical-day")}>Typical day</button>
            <button type="button" onClick={() => jumpTo("bring")}>What to bring</button>
            <button type="button" onClick={() => jumpTo("food")}>Food</button>
            <button type="button" onClick={() => jumpTo("activities")}>Special activities</button>
          </nav>
          <section data-camp-info-section="typical-day">
            <span>01</span><h3>A typical camp day</h3>
            <div className="lab-camp-info-timeline">{content.typicalDay.map(([title, description], index) => <article key={title}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{title}</strong><p>{description}</p></div></article>)}</div>
            <small>{content.typicalDayNote}</small>
          </section>
          <section data-camp-info-section="bring">
            <span>02</span><h3>What to bring</h3>
            <p>Please send your child with:</p>
            <ul>{content.whatToBring.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>Depending on the weather, this may include:</p>
            <ul>{content.weatherItems.map((item) => <li key={item}>{item}</li>)}</ul>
            <small>{content.bringNote}</small>
          </section>
          <section data-camp-info-section="food">
            <span>03</span><h3>Food</h3>
            {content.food.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
          <section data-camp-info-section="activities">
            <span>04</span><h3>Special activities</h3>
            <p>{content.specialActivitiesIntro}</p>
            <ul>{content.specialActivities.map((item) => <li key={item}>{item}</li>)}</ul>
            <small>{content.specialActivitiesNote}</small>
          </section>
          <section data-camp-info-section="additional">
            <span>05</span><h3>Additional information</h3>
            <p>{content.additionalInformation}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
