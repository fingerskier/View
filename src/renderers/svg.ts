import { image } from "./image";
import { withSource } from "./source";

// Rendered through <img>, so scripts inside the SVG never run.
export default withSource(image);
