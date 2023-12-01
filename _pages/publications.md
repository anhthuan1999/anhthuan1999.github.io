---
layout: page
permalink: /publications/
title: Publications
description: #Selected publications only. #Please refer to <a href='https://scholar.google.com/citations?user=bIdARZMAAAAJ&hl=vi'><u>Google Scholar</u></a> for full publications.
years: [2024,2023,2022,2021,2020,2019]
nav: true
nav_order: 1
wacv_pdf: ThuanTran_WACV2024.pdf
---
<!-- _pages/publications.md -->
<div class="publications">

{%- for y in page.years %}
  <h2 class="year">{{y}}</h2>
  {% bibliography -f {{ site.scholar.bibliography }} -q @*[year={{y}}]* %}
{% endfor %}

</div>
