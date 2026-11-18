export const histogramOperations = {
  getChunkRange: ({ data }) => {
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    return { minimum, maximum };
  },
  calcHistogram: ({ data, options }) => {
    if (options === undefined) {
      options = {};
    }
    const histogram = {
      numBins: options.numBins || 256,
      range: { min: 0, max: 0 },
      bins: new Int32Array(1),
      maxBin: 0,
      maxBinValue: 0,
    };

    let minToUse = options.min;
    let maxToUse = options.max;

    if (minToUse === undefined || maxToUse === undefined) {
      let min = Infinity;
      let max = -Infinity;
      let index = data.length;

      while (index--) {
        const value = data[index];
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }

      minToUse = min;
      maxToUse = max;
    }

    histogram.range = { min: minToUse, max: maxToUse };

    const bins = new Int32Array(histogram.numBins);
    const binScale = histogram.numBins / (maxToUse - minToUse);

    for (let index = 0; index < data.length; index++) {
      const value = data[index];
      if (value < minToUse) {
        continue;
      }
      if (value > maxToUse) {
        continue;
      }
      const bin = maxToUse === minToUse ? 0
        : Math.min(histogram.numBins - 1, Math.floor((value - minToUse) * binScale));
      if (!Number.isFinite(value)) continue;
      bins[bin] += 1;
    }

    histogram.bins = bins;
    histogram.maxBin = 0;
    histogram.maxBinValue = 0;

    for (let bin = 0; bin < histogram.numBins; bin++) {
      if (histogram.bins[bin] > histogram.maxBinValue) {
        histogram.maxBin = bin;
        histogram.maxBinValue = histogram.bins[bin];
      }
    }

    return histogram;
  },
};

