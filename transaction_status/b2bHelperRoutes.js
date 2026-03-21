function logBasicAmount(payload) {
  try {
    const valueString =
      payload?.Result?.ResultParameters?.ResultParameter?.Value;

    if (!valueString) {
      console.log("BasicAmount not found");
      return;
    }

    // Extract BasicAmount using regex
    const match = valueString.match(/BasicAmount=([\d.]+)/);

    if (match && match[1]) {
      const basicAmount = parseFloat(match[1]);
      console.log("BasicAmount: ", basicAmount);
    } else {
      console.log("BasicAmount not found in string");
    }
  } catch (error) {
    console.error("Error extracting BasicAmount:", error);
  }
}

module.exports = { logBasicAmount };