main.floors.MT545=
{
    "floorId": "MT545",
    "title": "545 层",
    "name": "545 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 5000000000,
    "defaultGround": 360033,
    "bgm": "30.mp3",
    "weather": [
        "fog",
        1
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,6": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "7,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT545_9_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT545_9_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,6": [
            {
                "type": "setValue",
                "name": "flag:door_MT545_9_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT545_9_6",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT545_9_6",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "9,6": {
            "0": {
                "condition": "flag:door_MT545_9_6==5",
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
                        "name": "flag:door_MT545_9_6",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "10,6": {
            "0": {
                "condition": "flag:door_MT545_9_6==5",
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
                        "name": "flag:door_MT545_9_6",
                        "operator": "=",
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
    [187,187,187,187,187, 21,360725, 22,1556,  0,643,360032,1562],
    [187,1012,1561, 86, 86,  0, 21,  0,360016,360017,360017,360018,360049],
    [187,187,187,187,187, 21,187,187,360032,360726,360727,360034,360065],
    [187,638,1010,638,1538,  0,187,1408,360048,360049,360049,360050,360081],
    [187, 22,1015,640,187, 21,187,  0,360064,360065,360065,360066,646],
    [187,187,187,187,187,  0,187,1409,360080,360081,360081,360082,1552],
    [ 47,  0,1546, 50,1546, 22, 86,  0,869, 85, 85, 87, 81],
    [187,187,187,187,187,  0,187,1409,360016,360017,360017,360018,1552],
    [187, 23,1015,639,187, 21,187,  0,360032,360726,360727,360034,646],
    [187,638,1009,638,1538,  0,187,1408,360048,360049,360049,360050,360017],
    [187,187,187,187,187, 21,187,187,360064,360065,360065,360048,360049],
    [187, 88,  0, 86, 86,  0, 21,  0,360080,360081,360081,360064,360065],
    [187,187,187,187,187, 21,360725, 22,1556,  0,644,360080,360081]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,360710,360711,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,360710,360711,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,360709,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}