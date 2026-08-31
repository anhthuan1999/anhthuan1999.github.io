---
layout: page
title: Academic Tree
description: Tracing my academic family tree back to 19th-century Königsberg and Leipzig
permalink: /lineage/
nav: false
nav_order: 5
---

<p>
Every advisor has an advisor. Follow the chain of PhD supervisors far enough back and it turns into a walk through the history of mathematics, physics, and computer science. Here's mine — coded up as an actual tree, not just a screenshot.
</p>

<div class="lineage-wrap">
  <div class="lineage-tree">

    <!-- Row 1 -->
    <div class="lineage-node" style="left:0px; top:0px;">
      <div class="name">Friedrich Julius Richelot</div>
      <div class="aff">Universität Königsberg</div>
    </div>
    <div class="lineage-node" style="left:255px; top:0px;">
      <div class="name">Otto Hesse</div>
      <div class="aff">Technische Hochschule München</div>
    </div>
    <div class="lineage-node" style="left:510px; top:0px;">
      <div class="name">Carl Gustav Jacob Jacobi</div>
      <div class="aff">Universität Königsberg</div>
    </div>

    <!-- Connectors: Row1 -> Row2 -->
    <div class="lineage-line-v" style="left:94px; top:56px; height:59px;"></div>
    <div class="lineage-line-v" style="left:349px; top:56px; height:59px;"></div>
    <div class="lineage-line-v" style="left:604px; top:56px; height:59px;"></div>
    <div class="lineage-line-h" style="left:95px; top:115px; width:255px;"></div>
    <div class="lineage-line-h" style="left:350px; top:115px; width:255px;"></div>
    <div class="lineage-line-v" style="left:221px; top:115px; height:35px;"></div>
    <div class="lineage-line-v" style="left:476px; top:115px; height:35px;"></div>

    <!-- Row 2 -->
    <div class="lineage-node" style="left:128px; top:150px;">
      <div class="name">Carl Gottfried Neumann</div>
      <div class="aff">Universität Leipzig</div>
    </div>
    <div class="lineage-node" style="left:383px; top:150px;">
      <div class="name">Wilhelm Scheibner</div>
      <div class="aff">Universität Leipzig</div>
    </div>

    <!-- Connectors: Row2 -> Row3 -->
    <div class="lineage-line-v" style="left:221px; top:206px; height:54px;"></div>
    <div class="lineage-line-v" style="left:476px; top:206px; height:54px;"></div>
    <div class="lineage-line-h" style="left:222px; top:260px; width:255px;"></div>
    <div class="lineage-line-v" style="left:349px; top:260px; height:40px;"></div>

    <!-- Row 3 -->
    <div class="lineage-node" style="left:255px; top:300px;">
      <div class="name">William Edward Story</div>
      <div class="aff">Clark University</div>
    </div>

    <div class="lineage-line-v" style="left:349px; top:356px; height:44px;"></div>

    <!-- Row 4 -->
    <div class="lineage-node" style="left:255px; top:400px;">
      <div class="name">Solomon Lefschetz</div>
      <div class="aff">Princeton University</div>
    </div>

    <div class="lineage-line-v" style="left:349px; top:456px; height:44px;"></div>

    <!-- Row 5 -->
    <div class="lineage-node" style="left:255px; top:500px;">
      <div class="name">John McCarthy</div>
      <div class="aff">Stanford University</div>
    </div>

    <div class="lineage-line-v" style="left:349px; top:556px; height:44px;"></div>

    <!-- Row 6 -->
    <div class="lineage-node" style="left:255px; top:600px;">
      <div class="name">Ruzena Bajcsy</div>
      <div class="aff">University of Pennsylvania</div>
    </div>

    <div class="lineage-line-v" style="left:349px; top:656px; height:44px;"></div>

    <!-- Row 7 -->
    <div class="lineage-node" style="left:255px; top:700px;">
      <div class="name">Jana Kosecka</div>
      <div class="aff">George Mason University</div>
    </div>

    <div class="lineage-line-v" style="left:349px; top:756px; height:44px;"></div>

    <!-- Row 8: me -->
    <div class="lineage-node me" style="left:255px; top:800px;">
      <div class="name">Anh Thuan Tran</div>
      <div class="aff">George Mason University</div>
    </div>

  </div>
</div>

<hr>

<h4>A few fun facts about the family</h4>

<ul class="lineage-facts">
  <li><strong>Carl Gustav Jacob Jacobi</strong> — one of the first mathematicians to run research seminars the way we still do today, and the first Jewish mathematician to hold a full professorship at a German university. He also liked to say <em>"man muss immer umkehren"</em> — "one must always invert."</li>
  <li><strong>Otto Hesse</strong> — the <em>Hessian matrix</em>, a staple of every optimization and deep-learning course, is named after him. He studied in the same Königsberg circle that trained physicist Gustav Kirchhoff.</li>
  <li><strong>Friedrich Julius Richelot</strong> — constructed a regular 257-sided polygon with just a ruler and compass. The proof ran nearly 200 pages.</li>
  <li><strong>Carl Gottfried Neumann</strong> — the <em>Neumann boundary condition</em>, used constantly in PDEs, heat equations, and physics simulation, carries his name. His father, Franz Ernst Neumann, was a founding figure of mathematical physics.</li>
  <li><strong>William Edward Story</strong> — helped build one of the first graduate research programs in mathematics in the United States, at Clark University in 1889.</li>
  <li><strong>Solomon Lefschetz</strong> — lost both hands in an industrial accident while working as an electrical engineer, then switched fields entirely and became one of the 20th century's most influential topologists.</li>
  <li><strong>John McCarthy</strong> — coined the term "Artificial Intelligence," invented the Lisp programming language, and won the Turing Award in 1971.</li>
  <li><strong>Ruzena Bajcsy</strong> — pioneered "active perception" in robotics and founded the GRASP Lab at the University of Pennsylvania, one of the first robotics labs in the US.</li>
  <li><strong>Jana Kosecka</strong> — co-authored <em>An Invitation to 3-D Vision</em>, a standard reference in computer vision, and now advises me at George Mason.</li>
</ul>

<style>
.lineage-wrap {
  overflow-x: auto;
  padding: 1rem 0 2rem;
}
.lineage-tree {
  position: relative;
  width: 700px;
  min-height: 880px;
  margin: 0 auto;
}
.lineage-node {
  position: absolute;
  width: 190px;
  text-align: center;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--global-divider-color);
  background: var(--global-card-bg-color);
  font-size: 0.85rem;
  line-height: 1.3;
}
.lineage-node.me {
  border: 2px solid var(--global-theme-color);
}
.lineage-node .name {
  font-weight: 600;
  color: var(--global-theme-color);
}
.lineage-node .aff {
  color: var(--global-text-color-light);
  font-size: 0.78rem;
}
.lineage-line-v {
  position: absolute;
  width: 2px;
  background: var(--global-theme-color);
  opacity: 0.45;
}
.lineage-line-h {
  position: absolute;
  height: 2px;
  background: var(--global-theme-color);
  opacity: 0.45;
}
.lineage-facts li {
  margin-bottom: 0.6rem;
}
</style>
