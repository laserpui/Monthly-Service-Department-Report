"use strict";

function createTablePagination(nav, onPageChange) {
  const pageSize = 10;
  const previous = nav.querySelector('[data-page="previous"]');
  const next = nav.querySelector('[data-page="next"]');
  const summary = nav.querySelector('[data-page-summary]');
  const number = new Intl.NumberFormat("th-TH");
  let page = 0;
  let total = 0;

  function update() {
    const start = page * pageSize;
    nav.hidden = total === 0;
    summary.textContent = total
      ? number.format(start + 1) + "–" + number.format(Math.min(total, start + pageSize)) +
        " จาก " + number.format(total) + " รายการ"
      : "";
    previous.disabled = page === 0;
    next.disabled = start + pageSize >= total;
  }

  function changePage(step) {
    const target = page + step;
    if (target < 0 || target * pageSize >= total) return;
    page = target;
    update();
    onPageChange();
  }

  previous.addEventListener("click", () => changePage(-1));
  next.addEventListener("click", () => changePage(1));

  return {
    reset(count) {
      total = count;
      page = 0;
      update();
    },
    get offset() { return page * pageSize; },
    get pageSize() { return pageSize; }
  };
}
