require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");
const tools = require("./config/tools");


const app = express();
const PORT = process.env.PORT || 3001;

// ensure upload/processed dirs exist
["uploads", "processed"].forEach((d) => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

connectDB();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {

    res.locals.tools = tools;

    next();

});


app.use("/", require("./routes/pages"));
app.use("/api", require("./routes/tools"));

app.use((req, res) => {
  res.status(404).render("404", { active: "" });
});

app.listen(PORT, () => {
  console.log(`🛠️  ImgToolkit running at http://localhost:${PORT}`);
});
