import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = dirname(fileURLToPath(import.meta.url));
const port = 8000;

const files = {
  "/": {
    name: "index.html",
    type: "text/html"
  },
  "/index.html": {
    name: "index.html",
    type: "text/html"
  },
  "/style.css": {
    name: "style.css",
    type: "text/css"
  },
  "/app.js": {
    name: "app.js",
    type: "text/javascript"
  }
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, {
      Allow: "GET"
    });

    response.end("Method not allowed");
    return;
  }

  const url = new URL(request.url, "http://localhost");
  const file = files[url.pathname];

  if (!file) {
    response.writeHead(404);
    response.end("File not found");
    return;
  }

  try {
    const content = await readFile(join(folder, file.name));

    response.writeHead(200, {
      "Content-Type": file.type + "; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });

    response.end(content);
  } catch (error) {
    console.error(error.message);

    response.writeHead(500);
    response.end("Unable to load the file");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(
      "Port 8000 is already being used. Stop the other server and try again."
    );
  } else {
    console.error(error.message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`WatchTower is running at http://localhost:${port}`);
});