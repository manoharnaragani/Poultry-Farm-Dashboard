const dayString = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const today = dayString(new Date());
export const dateOffset = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dayString(date);
};

export function createEmptyData() {
  return {
    sheds: [],
    workers: [], attendance: [], payments: [], assignments: [], feedStock: [],
    feedUsage: [], feedPurchases: [], eggs: [], mortality: [], sales: [],
    expenses: [], dailyWages: [],
    settings: { farmName: 'My Poultry Farm', owner: '', phone: '', address: '', currency: 'INR', timezone: 'Asia/Kolkata' },
  };
}
