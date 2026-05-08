---
layout: varsplat-project
title: VarSplat
permalink: /varsplat/
nav: false

paper_title: "VarSplat: Uncertainty-aware 3D Gaussian Splatting for Robust RGB-D SLAM"

authors:
  - name: Anh Thuan Tran
    url: https://anhthuan1999.github.io
    equal: false
  - name: Jana Kosecka
    url: https://people.cs.gmu.edu/~kosecka/
    equal: false

affiliations:
  - name: Department of Computer Science, George Mason University

venue: "CVPR 2026"

# paper_url: /assets/pdf/VarSplat_Preprint.pdf
arxiv_url: https://arxiv.org/abs/2603.09673
code_url: https://github.com/anhthuan1999/varsplat
# video_url:
poster_url: https://drive.google.com/file/d/1wRrahqVkxqIgIu5WHPwQ-xlv-ZGbxEZ5/view?usp=sharing
checkpoint_url: https://drive.google.com/drive/folders/1CaPlNdTewEkZCk0nHnmV5LhBx_XzwebX?usp=drive_link
---

## Visualization (ScanNet scene0169_00)

<div class="project-video">
  <video autoplay muted loop playsinline controls style="width:100%;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,0.12);">
    <source src="{{ '/assets/video/test3_lower.mp4' | relative_url }}" type="video/mp4">
    Your browser does not support the video tag.
  </video>
</div>
<p class="teaser-caption">
    <strong>VarSplat</strong> learns per-splat appearance variance online and renders differentiable per-pixel uncertainty map alongside input frame via single-pass rasterization, while simultaneously optimizing the map and inserting new Gaussians. 
</p>


---

<!-- Teaser -->
<div class="project-teaser">
  <img src="{{ '/assets/img/varsplat_overall.jpg' | relative_url }}" alt="VarSplat teaser" />
  <p class="teaser-caption">
    Given RGB-D inputs, each 3D Gaussian jointly learns <i>position</i>, <i>orientation</i>, <i>scale</i>, <i>color</i>, <i>opacity</i>, and <i>appearance variance</i>. During mapping, variance is optimized <i>jointly</i> with other Gaussian parameters.
  </p>
</div>


---

## Abstract


<div class="project-abstract">
<p>
Simultaneous Localization and Mapping (SLAM) with 3D Gaussian Splatting (3DGS) enables fast, differentiable rendering
and high-fidelity reconstruction across diverse real-world scenes. However, existing 3DGS-SLAM approaches handle
measurement reliability implicitly, making pose estimation and global alignment susceptible to drift in low-texture
regions, transparent surfaces, or areas with complex reflectance properties.
</p>
<p>
To this end, we introduce <strong>VarSplat</strong>, an uncertainty-aware 3DGS-SLAM system that explicitly learns
per-splat appearance variance. By using the <em>law of total variance</em> with alpha compositing, we compute
corresponding differentiable per-pixel uncertainty map via <em>efficient, single-pass rasterization</em>. This variance map guides tracking, submap registration, and
loop detection toward focusing on reliable regions and contributes to more stable optimization.
</p>
<p>
Experimental results on <strong>Replica</strong> (synthetic) and <strong>TUM-RGBD</strong>, <strong>ScanNet</strong>,
and <strong>ScanNet++</strong> (real-world) show that VarSplat improves robustness and achieves competitive or superior
tracking, mapping, and novel view synthesis rendering compared to existing studies for dense RGB-D SLAM.
</p>
</div>




---

## Method

<img src="{{ '/assets/img/varsplat_method.jpg' | relative_url }}" alt="VarSplat method" style="width:100%;max-width:900px;display:block;margin:0 auto 1rem;" />

VarSplat builds upon 3D Gaussian Splatting SLAM systems and introduces three main contributions:

<ul class="highlight-list">
  <li>
    <strong>Per-splat Appearance Variance:</strong> Each Gaussian explicitly models an appearance variance parameter
    in addition to color and opacity, capturing regions of photometric uncertainty.
  </li>
  <li>
    <strong>Differentiable Uncertainty Maps:</strong> Using the law of total variance integrated with alpha compositing,
    VarSplat renders differentiable per-pixel uncertainty maps alongside RGB images — no separate network required and can be operated in single-pass rasterization under online setting.
  </li>
  <li>
    <strong>Uncertainty-guided Optimization:</strong> The pixel-level uncertainty map is used to weight
    during camera tracking, submap registration, and loop closure detection,
    leading to more robust and consistent global alignment.
  </li>
</ul>

---

## BibTeX

<div class="bibtex-block">
  <button class="copy-bibtex-btn" title="Copy BibTeX">Copy</button>
<pre>@inproceedings{tran2026varsplat,
  title   = {VarSplat: Uncertainty-aware 3D Gaussian Splatting for Robust RGB-D SLAM},
  author  = {Tran, Anh Thuan and Kosecka, Jana},
  booktitle = {CVPR},
  year    = {2026}
}</pre>
</div>


