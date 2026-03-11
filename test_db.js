const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const dom = new JSDOM(`<!DOCTYPE html><body></body>`, {
    url: "http://localhost/",
    runScripts: "dangerously",
    resources: "usable"
});

const window = dom.window;
const document = window.document;

// Mock globals
global.window = window;
global.document = document;
global.navigator = window.navigator;

require('firebase/database'); // We don't have this in node_modules? Let's check.
