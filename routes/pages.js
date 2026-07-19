const express = require("express");
const router = express.Router();

const tools = require("../config/tools");
const Conversion = require("../models/Conversion");

// ===============================
// Home
// ===============================

router.get("/", async (req, res) => {

    let stats = { total: 0 };

    try {

        stats.total = await Conversion.countDocuments();

    }

    catch (err) {

        stats.total = 0;

    }

    res.render("index", {

        tools,

        stats,

        active: "home"

    });

});

// ===============================
// Static Pages
// ===============================

router.get("/about", (req, res) => {

    res.render("about", {

        active: "about"

    });

});

router.get("/contact", (req, res) => {

    res.render("contact", {

        active: "contact"

    });

});

router.get("/pricing", (req, res) => {

    res.render("pricing", {

        active: "pricing"

    });

});

router.get("/faq", (req, res) => {

    res.render("faq", {

        active: "faq"

    });

});

router.get("/login", (req, res) => {
  res.render("login", {
    pageTitle: "Login — ImgToolkit",
    active: "login"
  });
});

router.get("/register", (req, res) => {
  res.render("register", {
    pageTitle: "Register — ImgToolkit",
    active: "register"
  });
});

router.get("/dashboard", (req, res) => {

    res.render("dashboard", {

        active: "dashboard"

    });

});

router.get("/profile", (req, res) => {

    res.render("profile", {

        active: "profile"

    });

});

router.get("/settings", (req, res) => {

    res.render("settings", {

        active: "settings"

    });

});

router.get("/privacy", (req, res) => {

    res.render("privacy", {

        active: "privacy"

    });

});

router.get("/terms", (req, res) => {

    res.render("terms", {

        active: "terms"

    });

});

// ===============================
// Tool Page
// ===============================

router.get("/tool/:slug", (req, res) => {

    const tool = tools.find(

        tool => tool.slug === req.params.slug

    );

    if (!tool) {

        return res.status(404).render("404", {

            active: ""

        });

    }

    res.render("tool", {

        tool,

        tools,

        active: tool.slug

    });

});

module.exports = router;