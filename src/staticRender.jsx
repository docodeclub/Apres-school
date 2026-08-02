import { renderToStaticMarkup } from "react-dom/server";
import { StaticPublicPage } from "./app.jsx";

export function renderStaticPublicPage(page) {
  return renderToStaticMarkup(<StaticPublicPage page={page} />);
}
