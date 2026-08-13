/**
 * mobile-spec obs HTML 看板模板渲染。
 *
 * 使用 mustache 编译 scripts/obs/templates/dashboard.html；数据整理在
 * dashboard-data.js，模板只负责插值、列表和显隐。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');

const DEFAULT_TEMPLATE = path.join(__dirname, 'templates', 'dashboard.html');

function readDashboardTemplate(file = DEFAULT_TEMPLATE) {
  return fs.readFileSync(file, 'utf8');
}

function renderDashboardHtml(data, template = readDashboardTemplate()) {
  return Mustache.render(template, data || {});
}

module.exports = {
  renderDashboardHtml,
  readDashboardTemplate,
};
