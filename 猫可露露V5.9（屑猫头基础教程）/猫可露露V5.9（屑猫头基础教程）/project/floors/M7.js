main.floors.M7=
{
    "floorId": "M7",
    "title": "心境 M7",
    "name": "心境 M7",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1895,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,1": [
            {
                "type": "setValue",
                "name": "flag:door_M7_1_3",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,2": [
            {
                "type": "setValue",
                "name": "flag:door_M7_1_3",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,1": [
            {
                "type": "setValue",
                "name": "flag:door_M7_1_3",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "1,3": {
            "0": {
                "condition": "flag:door_M7_1_3==3",
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
                        "name": "flag:door_M7_1_3",
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
    [1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886],
    [1886,1968,  0,1968,1886,1014, 47,1486,1886, 21, 21, 21,1886],
    [  4,  0,1968,  0,1886,1963,1886,1964,1886, 22,1969, 21,1886],
    [2071, 85,  0,1019,1886,2070,1886,2070,1886,1886, 15,1886,1886],
    [  4,1886, 16,1886,1886, 82,1886, 15,1886,644,1968,644,1886],
    [1886,  0,1012,  0,1965,  0,1962,  0,1965,  0,1015,  0,1886],
    [1886,1963,  0,643,1886,1886, 81,1886,1886,1012,  0,1966,1886],
    [1886, 81,1886, 81,1886,644,  0,643,1886,1886,1886, 81,1886],
    [1886,1967,1886,  0,1966,  0, 15,  0,1964,  0,1963,1015,1886],
    [1886,  0,  4,1973,  4,  4, 83,  4,  4, 81,1886,1886,1886],
    [1886,  0,  4,  0,  4,1012,2071,1012,  4,1962,646,  0,1886],
    [1886, 88,  4,643, 16,  0, 87,  0,  4,  0,732, 21,1886],
    [1886,1886,  4,  4,  4,  4,  4,  4,  4,1886,1886,1886,1886]
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