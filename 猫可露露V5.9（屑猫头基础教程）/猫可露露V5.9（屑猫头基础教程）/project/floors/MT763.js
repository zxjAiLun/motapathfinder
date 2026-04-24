main.floors.MT763=
{
    "floorId": "MT763",
    "title": "763 层",
    "name": "763 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1890,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT763_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT763_10_4",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,4": {
            "0": {
                "condition": "flag:door_MT763_10_4==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT763_10_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [1881,1881,1881,1881,1881,1881,1881,1881,  4,  4,  4,  4,  4],
    [1881, 88,  0, 81, 81,  0, 87,  0,  4, 21,1017, 22,  4],
    [1881,  0,643,1881,1881,2071,  0,1958, 83,1014, 23,1019,  4],
    [1881, 81,1881,1881,1881,1881, 81,1881,  4,1012,1486,1012,  4],
    [1881,  0,1881, 21, 21, 21,  0, 22,  4,  4, 85,  4,  4],
    [1881,1012,1881,1881,1881,1881,1881,1962,1881,1965,  0,1965,1881],
    [1881,  0,1959,1960,1959,1438,1881,  0,1881,  0,1019,  0,1881],
    [1881,1881,1881,1881,1881, 81,1881,1960,1881,1881, 81,1881,1881],
    [1881,  0,644,  0,1964,1015,1965,1015,1962,  0,643,  0,1881],
    [1881, 81,1881,1881,1881,1881,1881,1881,1881,1881,1881, 81,1881],
    [1881,1957,2070,1881,643, 21,1881, 22,1012,1881,2070,1965,1881],
    [1881,  0,1960, 82, 21,644,1881, 21,643, 15,1963,  0,1881],
    [1881,1881,1881,1881,1881,1881,1881,1881,1881,1881,1881,1881,1881]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}