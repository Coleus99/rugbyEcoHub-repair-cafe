const dateExceptions = [
  {
    year: 2025,
    month: 12,
    date: 20,
  },
  {
    year: 2026,
    month: 12,
    date: 19,
  },
];

const checkForForm = setInterval(() => {
  if (document.querySelector(".hs-form")) {
    clearInterval(checkForForm);
    insertDateDropdown();
  }
}, 100);

const insertDateDropdown = () => {
  const repairDateWrapper = document.querySelector(".hs_TICKET\\.requested_repair_date .input");
  const repairDateField = document.querySelector(".hs_TICKET\\.requested_repair_date .hs-input");
  if (!repairDateField) return;

  repairDateWrapper.style.display = "none";

  let dateDropdown = document.createElement("select");
  dateDropdown.appendChild(new Option("Select a date", ""));

  const today = new Date();
  let currentDate = new Date(today); // Use a mutable date object

  let validDates = [];
  let monthsChecked = 0;
  const MAX_MONTHS = 12; // Safety limit

  while (validDates.length < 6 && monthsChecked < MAX_MONTHS) {
    let year = currentDate.getFullYear();
    let month = currentDate.getMonth();
    let monthCount = 0;

    // Check all days in this month
    for (let date = 1; date <= 31; date++) {
      let isException = false;
      for (const exception of dateExceptions) {
        if (exception.year === year && exception.month - 1 === month && exception.date === date) {
          isException = true;
          monthCount++;
          break;
        }
      }
      if (isException) continue;
      let day = new Date(year, month, date);

      // Stop when reaching next month
      if (day.getMonth() !== month) break;

      // If it's a Saturday
      if (day.getDay() === 6) {
        monthCount++;
        if (monthCount === 1 || monthCount === 3) {
          if (day > today) {
            // Exclude past dates
            validDates.push(day);
            if (validDates.length >= 6) break;
          }
        }
      }
    }

    // Move to next month
    currentDate.setMonth(currentDate.getMonth() + 1);
    monthsChecked++;
  }

  console.log(validDates);

  // Add dates to dropdown
  validDates.forEach((saturday) => {
    dateDropdown.appendChild(new Option(formatDateLabel(saturday), formatDateValue(saturday)));
  });

  dateDropdown.setAttribute("tabindex", "-1");
  dateDropdown.addEventListener("click", (e) => e.preventDefault());

  repairDateWrapper.insertAdjacentElement("beforebegin", dateDropdown);

  dateDropdown.addEventListener("change", (e) => {
    e.preventDefault();
    console.log(e.target.value);
    repairDateField.value = e.target.value;
    repairDateField.setAttribute("value", e.target.value);
    repairDateField.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const formatDateLabel = (date) => {
  const day = date.getDate();
  const month = date.toLocaleString("en-GB", { month: "long" });
  const year = date.getFullYear();

  const suffix = (day) => {
    if (day > 3 && day < 21) return "th";
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  return `Saturday ${day}${suffix(day)} ${month} ${year}`;
};

const formatDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
