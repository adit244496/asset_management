import { istTodayLocal } from './dates';

export function formatIsoDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// `now` is today in India (istTodayLocal): its local fields are the IST date.
export function getDatePresets(now = istTodayLocal()) {
  const today = formatIsoDate(now);
  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return formatIsoDate(d);
  };

  const thisMonthStart = formatIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const thisMonthEnd = formatIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const lastMonthStart = formatIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = formatIsoDate(new Date(now.getFullYear(), now.getMonth(), 0));

  return [
    { label: 'Past 7 Days', from: daysAgo(7), to: today },
    { label: 'Past 30 Days', from: daysAgo(30), to: today },
    { label: 'Past 90 Days', from: daysAgo(90), to: today },
    { label: 'This Month', from: thisMonthStart, to: thisMonthEnd },
    { label: 'Last Month', from: lastMonthStart, to: lastMonthEnd },
    { label: 'This Year', from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` },
    { label: 'Last Year', from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` },
  ];
}
