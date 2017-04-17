(function() {
    var PerfMeter = function () {
        this.started = {};
        this.finished = {};
    };
    PerfMeter.prototype.start = function(label) {
        this.started[label] = window.performance ? window.performance.now() : +new Date();
    };
    PerfMeter.prototype.end = function(label) {
        var now = window.performance ? window.performance.now() : +new Date();
        this.finished[label] = now - (this.started[label] || now);
        delete this.started[label];
    };
    PerfMeter.prototype.get = function(label) {
        return this.finished[label];
    };
    PerfMeter.prototype.print = function(groupName, var_args) {
        console.group(groupName || 'Performance log');
        for (var i = 1; i < arguments.length; i++) {
            var val = this.get(arguments[i]);
            if (typeof val == 'number') val = val.toFixed(3);
            else val = '' + val;
            console.log(arguments[i] + ': ' + val + 'ms');
        }
        console.groupEnd(groupName || 'Performance log');
    };
    window.basePerfMeter = new PerfMeter();
    window.perfMeter = new PerfMeter();
})();

function generate5MinsOHLCData(startDate, rowsCount, openValue, spread, opt_startVolume) {
    function rand(opt_spreadMult, opt_spreadAdd) {
        var spreadMult = (isNaN(opt_spreadMult) ? 1 : opt_spreadMult) * spread;
        var spreadAdd = isNaN(opt_spreadAdd) ? -0.5 : +opt_spreadAdd;
        return Math.round(((Math.random() * spreadMult) + spreadMult * spreadAdd) * 100) * 0.01;
    }

    function randVolume(opt_prev) {
        if (!opt_prev)
            return Math.round(Math.random() * 1e3) + 1e3;
        var diff = Math.round(Math.random() * 2e2) - 4e2;
        return Math.abs(opt_prev + diff);
    }

    function nextDate(date) {
        date.setTime(date.getTime() + 1000 * 60 * 5);
        if (date.getUTCHours() > 18) {
            date.setUTCDate(date.getUTCDate() + 1);
            date.setUTCHours(9);
        }
        if (date.getUTCDay() == 6) {
            date.setUTCDate(date.getUTCDate() + 2);
        } else if (date.getUTCDay() == 0) {
            date.setUTCDate(date.getUTCDate() + 1);
        }
    }

    startDate = startDate instanceof Date ? startDate : new Date(startDate);
    var current = new Date(startDate.getTime());
    var index = -1;

    var data = [];
    var open = openValue, close, high, low;
    var volume = randVolume(opt_startVolume);
    while (++index < rowsCount) {
        var diff = rand();
        close = open + diff;
        if (close < 0) close = open - diff;
        high = Math.max(open, close) + rand(0.2, 0);
        low = Math.max(Math.min(open, close) - rand(0.2, 0), 0);
        volume = randVolume(volume);
        data.push([
            current.getTime(),
            open,
            high,
            low,
            close,
            volume
        ]);
        open = close + rand(0.0001);
        nextDate(current);
    }
    return {
        data: data,
        lastValue: open,
        lastDate: current,
        lastVolume: volume
    };
}

function generateSplineData(rowsCount, opt_startVolume) {
    var index = -1;

    var data = [];
    var value1 = randVolume(opt_startVolume);
    var value2 = randVolume(opt_startVolume);
    var value3 = randVolume(opt_startVolume);
    var value4 = randVolume(opt_startVolume);
    var value5 = randVolume(opt_startVolume);

    while (++index < rowsCount) {
        value1 = randVolume(value1);
        value2 = randVolume(value2);
        value3 = randVolume(value3);
        value4 = randVolume(value4);
        value5 = randVolume(value5);

        data.push([
            index,
            value1,
            value2,
            value3,
            value4
        ]);
    }

    function randVolume(opt_prev) {
        if (!opt_prev) {
            return Math.round(Math.random() * 1e3) + 1e3;
        }
        var diff = Math.round(Math.random() * 2e2) - 1e3;
        return Math.abs(opt_prev + diff);
    }

    return {
        data: data,
        lastValue1: value1,
        lastValue2: value2,
        lastValue3: value3,
        lastValue4: value4
    };
}



var rawData;
var perfMeter;
var ohlcMapping, columnMapping, scrollerMapping;
var streamingTimerId;
var streamingAverage = NaN;

var isFirstInit = true;

var chart;
var dataTable;

var chartConfiguration = 'ohlc-basic';
var initialPointsCount = 50000;
var streamPointsCount = 100;
var streamingInterval = 60;

var index = 0;

var chartType = $('#anystock-speed-test-chartType-select').find('option:selected').attr('data-chart');

var requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;

anychart.onDocumentReady(function () {
    var resultWidth = $('#anystock-speed-test-base-result').width();
    $('#anystock-speed-test-base-chart').css({'right': resultWidth + 50});

    $('.select').selectpicker();

    $('#start-base-chart-stream-btn').click(toggleStreaming);

    // first init
    createChart(initialPointsCount, chartConfiguration, execCreateStock);

    $('.select[data-action-type]').on('change', changeChart);
});

function changeChart() {    
    var $optionSelected = $(this).find("option:selected");
    var value = $optionSelected.val();
    var type = $(this).attr('data-action-type');

    if (type == 'configurationType') {
        chartConfiguration = value;
        stopStreaming();
        createChart(initialPointsCount, chartConfiguration, getFunctionForCreateChart(chartType));
    } else if (type == 'initialPointsCount') {
        initialPointsCount = value;
        stopStreaming();
        createChart(initialPointsCount, chartConfiguration, getFunctionForCreateChart(chartType))
    } else if (type == 'streamPointsCount') {
        streamPointsCount = value;
        removeStreamingStat();
        if (isStreaming()) {
            stopStreaming();
            startStreaming();
        }
    } else if (type == 'streamingInterval') {
        streamingInterval = value;
        removeStreamingStat();
        if (isStreaming()) {
            stopStreaming();
            startStreaming();
        }
    }
}

function getFunctionForCreateChart(chartType) {
    switch (chartType) {
        case 'stock-ohlc':
            return execCreateStock;
    }
}

function createChart(pointsCount, chartConfiguration, createChartFunc) {
    if (chart) {
        chart.dispose();
        chart = null;
        index = 0;
        $('#anystock-speed-test-base-chart').empty();
    }

    if (!isFirstInit) {
        showPreloader();
    }

    setTimeout(function () {
        isFirstInit = false;
        createChartFunc(pointsCount, chartConfiguration);
    }, 1);

}

function execCreateStock(pointsCount, chartConfiguration) {
    rawData = generate5MinsOHLCData(new Date(new Date().getUTCFullYear() - 4, 0), pointsCount, 100, 10, 100);

    perfMeter.start('Total');

    perfMeter.start('Creating data storage');
    dataTable = anychart.data.table(0);
    dataTable.addData(rawData.data);
    ohlcMapping = dataTable.mapAs();
    ohlcMapping.addField('open', 1, 'first');
    ohlcMapping.addField('high', 2, 'max');
    ohlcMapping.addField('low', 3, 'min');
    ohlcMapping.addField('close', 4, 'last');

    columnMapping = dataTable.mapAs();
    columnMapping.addField('value', 5, 'sum');

    scrollerMapping = dataTable.mapAs();
    scrollerMapping.addField('value', 4, 'last');

    perfMeter.end('Creating data storage');


    perfMeter.start('Creating chart instance');
    chart = anychart.stock();
    chart.listen('chartDraw', function () {
        $('#loader-wrapper').remove();
        hidePreloader();
    });
    if (chartConfiguration == 'ohlc-basic') {
        setBasicChartSettings();
    } else {
        setAdvancedChartSettings();
    }
    chart.container('anystock-speed-test-base-chart');
    perfMeter.end('Creating chart instance');

    perfMeter.start('Chart rendering');
    chart.draw();
    rawData.data = null;
    perfMeter.end('Chart rendering');

    perfMeter.end('Total');

    var resultContainer = $('#anystock-speed-test-base-result');
    resultContainer.empty();
    resultContainer.append('<h5>Rendering ' + addCommas(pointsCount) + ' Data Points</h5>');
    resultContainer.append(generateHTMLStatRecord('Creating data storage', perfMeter.get('Creating data storage')));
    resultContainer.append(generateHTMLStatRecord('Creating chart instance', perfMeter.get('Creating chart instance')));
    resultContainer.append(generateHTMLStatRecord('Chart rendering', perfMeter.get('Chart rendering')));
    resultContainer.append(generateHTMLStatRecord('Total', perfMeter.get('Total')));
}

function setBasicChartSettings() {
    var ohlcSeries = chart.plot(0).ohlc(ohlcMapping);
    ohlcSeries.name('OHLC Series');
    ohlcSeries.tooltip().textFormatter(ohlcTextformatter);
    chart.padding(10, 10, 10, 50);
    chart.plot(0).yAxis();
    chart.plot(0).grid(0).layout('h');
    chart.plot(0).minorGrid(0).layout('h');
    chart.plot(0).grid(1).layout('v');
    chart.plot(0).minorGrid(1).layout('v');
    chart.scroller().line(scrollerMapping);
}

function setAdvancedChartSettings() {
    var ohlcSeries = chart.plot(0).ohlc(ohlcMapping);
    ohlcSeries.tooltip().textFormatter(ohlcTextformatter);
    ohlcSeries.name('OHLC Series');

    var columbSeies = chart.plot(1).column(columnMapping);
    columbSeies.tooltip().textFormatter(volumeTextformatter);
    columbSeies.name('Column');

    chart.padding(10, 10, 10, 50);
    chart.plot(0).yAxis();
    chart.plot(1).height('30%');
    chart.plot(0).grid(0).layout('h');
    chart.plot(0).minorGrid(0).layout('h');
    chart.plot(0).grid(1).layout('v');
    chart.plot(0).minorGrid(1).layout('v');
    chart.plot(1).grid(0).layout('h');
    chart.plot(1).minorGrid(0).layout('h');
    chart.plot(1).yScale().minimum(0);
    chart.plot(1).grid(1).layout('v');
    chart.plot(1).minorGrid(1).layout('v');
    chart.plot(1).yAxis().labels().textFormatter(function () {
        var val = this['tickValue'];
        var neg = val < 0;
        val = Math.abs(val);
        if (val / 1e15 >= 1) {
            return (val / 1e9).toFixed(0) + 'Q';
        } else if (val / 1e12 >= 1) {
            return (val / 1e9).toFixed(0) + 'T';
        } else if (val / 1e9 >= 1) {
            return (val / 1e9).toFixed(0) + 'B';
        } else if (val / 1e6 >= 1) {
            return (val / 1e6).toFixed(0) + 'M';
        } else if (val / 1e3 >= 1) {
            return (val / 1e3).toFixed(0) + 'K';
        }
        return neg ? '-' + val : val;
    });


    chart.scroller().line(scrollerMapping);
}

function isStreaming() {
    return !isNaN(streamingTimerId);
}

function toggleStreaming() {
    if (!isStreaming()) {

        startStreaming();
    } else {
        stopStreaming();
    }
}

function startStreaming() {
    $('#start-base-chart-stream-btn').html('Stop Data Streaming');

    streamingTimerId = setInterval(function () {

        if (requestAnimationFrame) {
            requestAnimationFrame(streamData);
        } else {
            streamData();
        }

        function streamData() {
            rawData = generate5MinsOHLCData(rawData.lastDate, streamPointsCount, rawData.lastValue, 10, rawData.lastVolume);

            perfMeter.start(streamPointsCount);
            dataTable.addData(rawData.data, true);
            rawData.data = null;
            perfMeter.end(streamPointsCount);

            if (isNaN(streamingAverage)) streamingAverage = perfMeter.get(streamPointsCount);

            var streamingStat = $('#anystock-speed-test-stream-stat').length;
            if (!streamingStat) {
                var resultContainer = $('#anystock-speed-test-base-result');
                resultContainer.append('<h5 id="anystock-speed-test-stream-stat">Streaming ' + addCommas(streamPointsCount) + ' Data Points</h5>');
                resultContainer.append(generateHTMLStatRecord('Streaming interval', streamingInterval, undefined, 'anystock-speed-test-stream-interval'));
                resultContainer.append(generateHTMLStatRecord('Average rendering time', Math.round(streamingAverage), undefined, 'anystock-speed-test-stream-average'));
            } else {
                streamingAverage = (streamingAverage + perfMeter.get(streamPointsCount)) / 2;
                $('#anystock-speed-test-stream-average .anystock-speed-test-result-row-value').html(Math.round(streamingAverage) + 'ms');
            }
        }

    }, streamingInterval);
}

function stopStreaming() {
    if (isStreaming()) {
        clearInterval(streamingTimerId);
        streamingTimerId = NaN;
    }
    streamingAverage = NaN;
    $('#start-base-chart-stream-btn').html('Start Data Streaming');
}

function removeStreamingStat() {
    $('#anystock-speed-test-stream-stat').remove();
    $('#anystock-speed-test-stream-interval').remove();
    $('#anystock-speed-test-stream-average').remove();
}

function showPreloader() {
    $('#anystock-speed-test-base-chart').append('<div id="loader-wrapper-chart" class="anychart-loader"><div class="rotating-cover"><div class="rotating-plane"><div class="chart-row"><span class="chart-col green"></span><span class="chart-col orange"></span><span class="chart-col red"></span></div></div></div></div>');
}

function hidePreloader() {
    $('#loader-wrapper-chart').hide();
}

function ohlcTextformatter() {
    return 'Open: ' + parseFloat(this['open']).toFixed(2) + '\n' +
        'High: ' + parseFloat(this['high']).toFixed(2) + '\n' +
        'Low: ' + parseFloat(this['low']).toFixed(2) + '\n' +
        'Close: ' + parseFloat(this['close']).toFixed(2);
}

function volumeTextformatter() {
    return 'Volume: ' + parseFloat(this['value']).toFixed();
}

function generateHTMLStatRecord(title, value, postfix, opt_id) {
    if (postfix === undefined) postfix = 'ms';
    opt_id = opt_id ? 'id="' + opt_id + '" ' : '';
    return '<div ' + opt_id + 'class="anystock-speed-test-result-row clearfix"> ' +
        '<span class="anystock-speed-test-result-row-title">' + title + ': </span>' +
        '<span class="anystock-speed-test-result-row-value">' + Math.round(value) + postfix + '</span>' +
        '</div>';
}

function addCommas(nStr) {
    nStr += '';
    x = nStr.split('.');
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
        x1 = x1.replace(rgx, '$1' + ',' + '$2');
    }
    return x1 + x2;
}

