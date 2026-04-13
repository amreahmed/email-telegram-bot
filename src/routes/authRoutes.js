const express = require("express");
const { microsoftCallback } = require("../controllers/authController");

const router = express.Router();

router.get("/microsoft/callback", microsoftCallback);

module.exports = router;
