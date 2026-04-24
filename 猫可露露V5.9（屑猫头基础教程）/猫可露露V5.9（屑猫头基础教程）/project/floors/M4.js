main.floors.M4=
{
    "floorId": "M4",
    "title": "心境 M4",
    "name": "心境 M4",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1896,
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
                "name": "flag:door_M4_10_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_M4_10_4",
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
                "condition": "flag:door_M4_10_4==2",
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
                        "name": "flag:door_M4_10_4",
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
    [1887,1887,1887,1887,1887,1887,1887,1887,  4,  4,  4,  4,  4],
    [1887, 88,  0, 81, 81,  0, 87,  0,  4, 21,1017, 22,  4],
    [1887,  0,643,1887,1887,2071,  0,1958, 83,1014, 23,1019,  4],
    [1887, 81,1887,1887,1887,1887, 81,1887,  4,1012,1486,1012,  4],
    [1887,  0,1887, 21, 21, 21,  0, 22,  4,  4, 85,  4,  4],
    [1887,1012,1887,1887,1887,1887,1887,1962,1887,1965,  0,1965,1887],
    [1887,  0,1959,1960,1959,2070,1887,  0,1887,  0,1019,  0,1887],
    [1887,1887,1887,1887,1887, 81,1887,1960,1887,1887, 81,1887,1887],
    [1887,  0,644,  0,1964,1015,1965,1015,1962,  0,643,  0,1887],
    [1887, 81,1887,1887,1887,1887,1887,1887,1887,1887,1887, 81,1887],
    [1887,1957,2070,1887,643, 21,1887, 22,1012,1887,2070,1965,1887],
    [1887,  0,1960, 82, 21,644,1887, 21,643, 15,1963,  0,1887],
    [1887,1887,1887,1887,1887,1887,1887,1887,1887,1887,1887,1887,1887]
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