main.floors.MT604=
{
    "floorId": "MT604",
    "title": "604 层",
    "name": "604 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "10.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 50000000000,
    "defaultGround": 906,
    "bgm": "33.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT604_7_1",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "7,1": {
            "0": {
                "condition": "flag:door_MT604_7_1==1",
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
                        "name": "flag:door_MT604_7_1",
                        "value": "null"
                    }
                ]
            },
            "1": null
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [908,908,908,907,907,907,907,  4,  4,  4,  4,  4,  4],
    [908,643,  0,907,  0,1411,  0, 85,644,643,642,1010,  4],
    [908,  0,1605, 82,1010,644,1010,  4,1015,644,643,1011,  4],
    [908,1603,908,907,  0,1606,  0,  4,  4,  4,  4,  4,  4],
    [908,645, 82, 21,907,733,907,1010,1604, 81,  0,640,908],
    [908,645,908,1603, 50,908,1011, 82,642,908,645,  0,908],
    [908, 81,908,908,908,908, 16,908,908,908,1606,908,908],
    [908,1605,638,908,1015,908,  0,1602,  0, 81,639,  0,908],
    [908,  0,1605, 16,  0,1604,638,908,640,908,  0,1010,908],
    [908,1602,908,908,908,908,908,908,908,908,1602,908,908],
    [908,  0,639,1604,  0, 22, 81,1607,908,1010,  0, 21,908],
    [908, 87,  0,908,640,  0,908,  0,639,1603,908, 88,908],
    [908,908,908,908,908,908,908,908,908,908,908,908,908]
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